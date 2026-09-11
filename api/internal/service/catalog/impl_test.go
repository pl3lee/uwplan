package catalog_test

import (
	"errors"
	"testing"

	"github.com/google/go-cmp/cmp"
	"github.com/pl3lee/uwplan/api/internal/domain/course"
	service "github.com/pl3lee/uwplan/api/internal/service/catalog"
	"github.com/stretchr/testify/mock"
)

func TestUpdateValidatesBeforeWriting(t *testing.T) {
	t.Parallel()
	unavailable := errors.New("upstream unavailable")
	for _, tc := range []struct {
		name                  string
		data                  course.Import
		fetchError, wantError error
	}{
		{name: "fetch failure", fetchError: unavailable, wantError: unavailable},
		{name: "empty catalog", wantError: course.ErrInvalidImport},
		{name: "invalid record", data: course.Import{Courses: []course.Course{{Code: "CS135"}}}, wantError: course.ErrInvalidImport},
		{name: "normalized duplicate", data: course.Import{Courses: []course.Course{{Code: "CS135", Name: "First"}, {Code: "cs 135", Name: "Second"}}}, wantError: course.ErrInvalidImport},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			gateway, repository := service.NewCourseGatewayMock(t), service.NewCourseRepositoryMock(t)
			gateway.EXPECT().Fetch(mock.Anything).Return(tc.data, tc.fetchError).Once()
			got, err := service.NewCatalogService(gateway, repository).Update(t.Context())
			if !errors.Is(err, tc.wantError) {
				t.Fatalf("got %v, want %v", err, tc.wantError)
			}
			if diff := cmp.Diff(course.ImportResult{}, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}

func TestUpdateStoresCompleteNormalizedCatalog(t *testing.T) {
	t.Parallel()
	unavailable := errors.New("storage unavailable")
	for _, storeError := range []error{nil, unavailable} {
		t.Run("storage", func(t *testing.T) {
			t.Parallel()
			gateway, repository := service.NewCourseGatewayMock(t), service.NewCourseRepositoryMock(t)
			input := course.Import{Courses: []course.Course{{Code: "cs 136", Name: "Second"}, {Code: "cs135", Name: "First"}}}
			want := course.Import{Courses: []course.Course{{Code: "CS135", Name: "First"}, {Code: "CS136", Name: "Second"}}}
			gateway.EXPECT().Fetch(mock.Anything).Return(input, nil).Once()
			repository.EXPECT().Import(mock.Anything, mock.MatchedBy(func(got course.Import) bool { return cmp.Equal(want, got) })).Return(storeError).Once()
			got, err := service.NewCatalogService(gateway, repository).Update(t.Context())
			if !errors.Is(err, storeError) {
				t.Fatalf("got %v, want %v", err, storeError)
			}
			result := course.ImportResult{}
			if storeError == nil {
				result.Courses = 2
			}
			if diff := cmp.Diff(result, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
