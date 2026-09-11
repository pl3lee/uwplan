package seed_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/domain/template"
	service "github.com/pl3lee/uwplan/api/internal/service/seed"
	"github.com/stretchr/testify/mock"
)

func TestSeedValidatesAllDefinitionsBeforeStorage(t *testing.T) {
	t.Parallel()
	unavailable := errors.New("definitions unavailable")
	for _, tc := range []struct {
		name                  string
		data                  template.Seed
		fetchError, wantError error
	}{
		{name: "upstream", fetchError: unavailable, wantError: unavailable},
		{name: "empty", wantError: template.ErrInvalid},
		{name: "duplicate", data: template.Seed{Templates: []template.Blueprint{{Name: "A"}, {Name: " A "}}}, wantError: template.ErrInvalid},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			gateway, repo := service.NewTemplateGatewayMock(t), service.NewTemplateRepositoryMock(t)
			gateway.EXPECT().Fetch(mock.Anything).Return(tc.data, tc.fetchError).Once()
			got, err := service.NewSeedService(gateway, repo).Seed(t.Context())
			if !errors.Is(err, tc.wantError) {
				t.Fatalf("got %v", err)
			}
			if diff := cmp.Diff(template.SeedResult{}, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestSeedUsesNormalizedDefinitionsAndPreservesErrors(t *testing.T) {
	t.Parallel()
	for _, storeError := range []error{nil, template.ErrCourseNotFound, template.ErrNameExists} {
		t.Run("storage", func(t *testing.T) {
			t.Parallel()
			gateway, repo := service.NewTemplateGatewayMock(t), service.NewTemplateRepositoryMock(t)
			input := template.Seed{Templates: []template.Blueprint{{Name: " Z "}, {Name: "A"}}}
			want := template.Seed{Templates: []template.Blueprint{{Name: "A", Items: []template.DraftItem{}}, {Name: "Z", Items: []template.DraftItem{}}}}
			result := template.SeedResult{}
			if storeError == nil {
				result = template.SeedResult{Created: 1, Existing: 1}
			}
			gateway.EXPECT().Fetch(mock.Anything).Return(input, nil).Once()
			repo.EXPECT().Seed(mock.Anything, mock.MatchedBy(func(got template.Seed) bool { return cmp.Equal(want, got) })).Return(result, storeError).Once()
			got, err := service.NewSeedService(gateway, repo).Seed(t.Context())
			if !errors.Is(err, storeError) {
				t.Fatalf("got %v", err)
			}
			if diff := cmp.Diff(result, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
