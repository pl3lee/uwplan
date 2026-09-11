package course_test

import (
	"errors"
	"github.com/google/go-cmp/cmp"
	domaincourse "github.com/pl3lee/uwplan/api/internal/domain/course"
	service "github.com/pl3lee/uwplan/api/internal/service/course"
	"github.com/stretchr/testify/mock"
	"testing"
)

func TestCatalogReadPreservesCoursesAndFailureIdentity(t *testing.T) {
	t.Parallel()
	unavailable := errors.New("catalog unavailable")
	for _, tc := range []struct {
		name string
		rows []domaincourse.Course
		err  error
	}{
		{name: "catalog", rows: []domaincourse.Course{{Code: "CS135", Name: "Functional Programs"}}},
		{name: "unavailable", err: unavailable},
	} {
		t.Run(tc.name, func(t *testing.T) {
			t.Parallel()
			repo := service.NewCourseRepositoryMock(t)
			repo.EXPECT().List(mock.Anything).Return(tc.rows, tc.err).Once()
			got, err := service.NewCourseService(repo).List(t.Context())
			if !errors.Is(err, tc.err) {
				t.Fatalf("error = %v, want %v", err, tc.err)
			}
			if diff := cmp.Diff(tc.rows, got); diff != "" {
				t.Fatal(diff)
			}
		})
	}
}
