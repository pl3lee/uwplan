// Package migrations adopts the existing public schema without replaying DDL.
package migrations

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	"embed"
	"encoding/json"
	"errors"
	"fmt"
	"io/fs"

	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

//go:embed legacy_schema.sql
var legacySchema string

//go:embed fingerprint.sql
var fingerprintQuery string

//go:embed legacy_fingerprint.json
var legacyFingerprint []byte

//go:embed sql/*.sql
var migrationFiles embed.FS

const CurrentVersion = 2

var ErrSchemaMismatch = errors.New("public schema does not match the verified legacy baseline")

func Up(ctx context.Context, db *sql.DB) error {
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return fmt.Errorf("create migration lock: %w", err)
	}
	files, err := fs.Sub(migrationFiles, "sql")
	if err != nil {
		return fmt.Errorf("load migrations: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, db, files, goose.WithDisableGlobalRegistry(true), goose.WithSessionLocker(locker), goose.WithGoMigrations(
		goose.NewGoMigration(1, &goose.GoFunc{RunTx: baseline}, nil),
	))
	if err != nil {
		return fmt.Errorf("create migration provider: %w", err)
	}
	if _, err = provider.Up(ctx); err != nil {
		return fmt.Errorf("migrate schema: %w", err)
	}
	return nil
}

func baseline(ctx context.Context, tx *sql.Tx) error {
	// Keep PostgreSQL's deparser output independent of the connection's search path.
	if _, err := tx.ExecContext(ctx, "SET LOCAL search_path TO public"); err != nil {
		return err
	}
	var tables int
	if err := tx.QueryRowContext(ctx, `SELECT count(*) FROM information_schema.tables WHERE table_schema='public' AND table_name<>'goose_db_version'`).Scan(&tables); err != nil {
		return err
	}
	if tables == 0 {
		if _, err := tx.ExecContext(ctx, legacySchema); err != nil {
			return fmt.Errorf("bootstrap schema: %w", err)
		}
	}
	var actual []byte
	if err := tx.QueryRowContext(ctx, fingerprintQuery).Scan(&actual); err != nil {
		return fmt.Errorf("inspect legacy schema: %w", err)
	}
	expected, err := canonicalJSON(legacyFingerprint)
	if err != nil {
		return err
	}
	found, err := canonicalJSON(actual)
	if err != nil {
		return err
	}
	if !bytes.Equal(expected, found) {
		return ErrSchemaMismatch
	}
	return nil
}

func canonicalJSON(data []byte) ([]byte, error) {
	var value any
	if err := json.Unmarshal(data, &value); err != nil {
		return nil, err
	}
	return json.Marshal(value)
}

// Hash identifies the migration inputs for isolated pgtestdb templates.
func Hash() string {
	hash := sha256.New()
	fmt.Fprint(hash, "baseline-v1\n", legacySchema, fingerprintQuery, string(legacyFingerprint))
	err := fs.WalkDir(migrationFiles, ".", func(path string, entry fs.DirEntry, err error) error {
		if err != nil {
			return err
		}
		if !entry.IsDir() {
			data, err := migrationFiles.ReadFile(path)
			if err != nil {
				return err
			}
			fmt.Fprint(hash, path, "\n", string(data))
		}
		return nil
	})
	if err != nil {
		// Embedded files are immutable; an unreadable input is a programming error,
		// never a reason to reuse a database template with an incomplete hash.
		panic(fmt.Errorf("hash embedded migrations: %w", err))
	}
	return fmt.Sprintf("%x", hash.Sum(nil))
}
