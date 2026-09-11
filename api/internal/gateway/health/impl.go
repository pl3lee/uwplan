package health

import (
	"context"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
	domainhealth "github.com/pl3lee/uwplan/api/internal/domain/health"
	"github.com/redis/go-redis/v9"
)

type HealthGatewayImpl struct {
	database *pgxpool.Pool
	redis    *redis.Client
}

func NewHealthGateway(database *pgxpool.Pool, redisClient *redis.Client) *HealthGatewayImpl {
	return &HealthGatewayImpl{database: database, redis: redisClient}
}

func (g *HealthGatewayImpl) Check(ctx context.Context) domainhealth.Report {
	result := domainhealth.Report{Database: domainhealth.Unavailable, Redis: domainhealth.Unavailable}
	var group sync.WaitGroup
	group.Go(func() {
		if g.database.Ping(ctx) == nil {
			result.Database = domainhealth.Available
		}
	})
	group.Go(func() {
		if g.redis.Ping(ctx).Err() == nil {
			result.Redis = domainhealth.Available
		}
	})
	group.Wait()
	return result
}
