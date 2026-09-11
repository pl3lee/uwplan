//go:build integration

package course_test

import (
	"github.com/google/go-cmp/cmp"
	"github.com/google/uuid"
	domaincourse "github.com/pl3lee/uwplan/api/internal/domain/course"
	repository "github.com/pl3lee/uwplan/api/internal/repository/course"
	"github.com/pl3lee/uwplan/api/internal/testutil/postgres"
	"testing"
)

func TestCatalogPreservesRatingsAndSortsByCode(t *testing.T) {
	t.Parallel()
	pool := postgres.NewPool(t)
	repo := repository.NewCourseRepository(pool)
	empty, err := repo.List(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	if diff := cmp.Diff([]domaincourse.Course{}, empty); diff != "" {
		t.Fatal(diff)
	}
	_, err = pool.Exec(t.Context(), `INSERT INTO course(id,code,name,description,prereqs,antireqs,coreqs,useful_rating,liked_rating,easy_rating,num_ratings) VALUES
 ('22222222-2222-4222-8222-222222222222','MATH135','Algebra','','','','',NULL,NULL,NULL,NULL),
 ('11111111-1111-4111-8111-111111111111','CS135','Functional Programs','Functions','None','CS115','MATH135',.800,.700,.600,100)`)
	if err != nil {
		t.Fatal(err)
	}
	got, err := repo.List(t.Context())
	if err != nil {
		t.Fatal(err)
	}
	useful, liked, easy := "0.800", "0.700", "0.600"
	count := int32(100)
	want := []domaincourse.Course{
		{ID: uuid.MustParse("11111111-1111-4111-8111-111111111111"), Code: "CS135", Name: "Functional Programs", Description: "Functions", Prereqs: "None", Antireqs: "CS115", Coreqs: "MATH135", UsefulRating: &useful, LikedRating: &liked, EasyRating: &easy, NumRatings: &count},
		{ID: uuid.MustParse("22222222-2222-4222-8222-222222222222"), Code: "MATH135", Name: "Algebra"},
	}
	if diff := cmp.Diff(want, got); diff != "" {
		t.Fatal(diff)
	}
}
