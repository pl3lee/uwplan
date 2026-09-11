package session

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	domainsession "github.com/pl3lee/uwplan/api/internal/domain/session"
	"github.com/redis/go-redis/v9"
)

type SessionRepositoryImpl struct{ client *redis.Client }

func NewSessionRepository(client *redis.Client) *SessionRepositoryImpl {
	return &SessionRepositoryImpl{client: client}
}

type record struct {
	ID        string    `json:"id"`
	UserID    string    `json:"user_id"`
	TokenHash string    `json:"token_hash"`
	CreatedAt time.Time `json:"created_at"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (r *SessionRepositoryImpl) Create(ctx context.Context, input domainsession.Session) error {
	ttl := time.Until(input.ExpiresAt)
	if ttl <= 0 || input.UserID == "" || input.ID == "" || input.TokenHash == "" {
		return domainsession.ErrInvalid
	}
	value := record{input.ID, input.UserID, input.TokenHash, input.CreatedAt, input.ExpiresAt}
	payload, err := json.Marshal(value)
	if err != nil {
		return fmt.Errorf("encode session: %w", err)
	}
	created, err := r.client.SetNX(ctx, key(input.TokenHash), payload, ttl).Result()
	if err != nil {
		return fmt.Errorf("store session: %w", err)
	}
	if !created {
		return fmt.Errorf("session token collision: %w", domainsession.ErrInvalid)
	}
	return nil
}

func (r *SessionRepositoryImpl) Get(ctx context.Context, input domainsession.Session) (domainsession.Session, error) {
	if input.TokenHash == "" {
		return domainsession.Session{}, domainsession.ErrInvalid
	}
	payload, err := r.client.Get(ctx, key(input.TokenHash)).Bytes()
	if errors.Is(err, redis.Nil) {
		return domainsession.Session{}, domainsession.ErrInvalid
	}
	if err != nil {
		return domainsession.Session{}, fmt.Errorf("read session: %w", err)
	}
	var value record
	if err = json.Unmarshal(payload, &value); err != nil {
		return domainsession.Session{}, fmt.Errorf("decode session: %w", err)
	}
	result := domainsession.Session{ID: value.ID, UserID: value.UserID, TokenHash: value.TokenHash, CreatedAt: value.CreatedAt, ExpiresAt: value.ExpiresAt}
	if result.TokenHash != input.TokenHash || !result.IsActive(time.Now()) {
		return domainsession.Session{}, domainsession.ErrInvalid
	}
	return result, nil
}

func (r *SessionRepositoryImpl) Revoke(ctx context.Context, input domainsession.Session) error {
	if input.TokenHash == "" {
		return nil
	}
	if err := r.client.Del(ctx, key(input.TokenHash)).Err(); err != nil {
		return fmt.Errorf("delete session: %w", err)
	}
	return nil
}

func key(hash string) string { return "uwplan:session:" + hash }
