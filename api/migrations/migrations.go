// Package migrations adopts the existing public schema without replaying DDL.
package migrations

import (
	"bytes"
	"context"
	"crypto/sha256"
	"database/sql"
	_ "embed"
	"encoding/json"
	"errors"
	"fmt"

	"github.com/pressly/goose/v3"
	"github.com/pressly/goose/v3/lock"
)

//go:embed legacy_schema.sql
var legacySchema string

//go:embed fingerprint.sql
var fingerprintQuery string

//go:embed legacy_fingerprint.json
var legacyFingerprint []byte

var ErrSchemaMismatch = errors.New("public schema does not match the verified legacy baseline")

func Up(ctx context.Context, db *sql.DB) error {
	locker, err := lock.NewPostgresSessionLocker()
	if err != nil {
		return fmt.Errorf("create migration lock: %w", err)
	}
	provider, err := goose.NewProvider(goose.DialectPostgres, db, nil, goose.WithDisableGlobalRegistry(true), goose.WithSessionLocker(locker), goose.WithGoMigrations(
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
	return fmt.Sprintf("%x", sha256.Sum256([]byte("baseline-v1\n"+legacySchema+fingerprintQuery+string(legacyFingerprint))))
}
