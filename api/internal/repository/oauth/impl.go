package oauth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"time"

	domainoauth "github.com/pl3lee/uwplan/api/internal/domain/oauth"
	"github.com/pl3lee/uwplan/api/internal/domain/user"
	"github.com/redis/go-redis/v9"
)

type OAuthRepositoryImpl struct{ client *redis.Client }

func NewOAuthRepository(client *redis.Client) *OAuthRepositoryImpl {
	return &OAuthRepositoryImpl{client: client}
}

type record struct {
	StateHash string    `json:"state_hash"`
	Provider  string    `json:"provider"`
	Verifier  string    `json:"verifier"`
	Nonce     string    `json:"nonce"`
	ReturnTo  string    `json:"return_to"`
	ExpiresAt time.Time `json:"expires_at"`
}

func (r *OAuthRepositoryImpl) Create(ctx context.Context, input domainoauth.Flow) error {
	ttl := time.Until(input.ExpiresAt)
	if ttl <= 0 || input.StateHash == "" {
		return domainoauth.ErrInvalidState
	}
	payload, err := json.Marshal(record{input.StateHash, string(input.Provider), input.Verifier, input.Nonce, input.ReturnTo, input.ExpiresAt})
	if err != nil {
		return fmt.Errorf("encode OAuth state: %w", err)
	}
	created, err := r.client.SetNX(ctx, key(input.StateHash), payload, ttl).Result()
	if err != nil {
		return fmt.Errorf("store OAuth state: %w", err)
	}
	if !created {
		return domainoauth.ErrInvalidState
	}
	return nil
}

func (r *OAuthRepositoryImpl) Consume(ctx context.Context, input domainoauth.Flow) (domainoauth.Flow, error) {
	if input.StateHash == "" {
		return domainoauth.Flow{}, domainoauth.ErrInvalidState
	}
	payload, err := r.client.GetDel(ctx, key(input.StateHash)).Bytes()
	if errors.Is(err, redis.Nil) {
		return domainoauth.Flow{}, domainoauth.ErrInvalidState
	}
	if err != nil {
		return domainoauth.Flow{}, fmt.Errorf("consume OAuth state: %w", err)
	}
	var value record
	if err = json.Unmarshal(payload, &value); err != nil {
		return domainoauth.Flow{}, fmt.Errorf("decode OAuth state: %w", err)
	}
	if value.StateHash != input.StateHash || !time.Now().Before(value.ExpiresAt) {
		return domainoauth.Flow{}, domainoauth.ErrInvalidState
	}
	return domainoauth.Flow{StateHash: value.StateHash, Provider: user.Provider(value.Provider), Verifier: value.Verifier, Nonce: value.Nonce, ReturnTo: value.ReturnTo, ExpiresAt: value.ExpiresAt}, nil
}

func key(hash string) string { return "uwplan:oauth:" + hash }
