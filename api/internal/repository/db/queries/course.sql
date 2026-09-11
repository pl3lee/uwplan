-- name: ListCatalogCourses :many
SELECT * FROM course ORDER BY code;

-- name: UpsertCatalogCourse :exec
INSERT INTO course(id,code,name,description,prereqs,antireqs,coreqs,useful_rating,liked_rating,easy_rating,num_ratings)
VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
ON CONFLICT(code) DO UPDATE SET name=excluded.name,description=excluded.description,
prereqs=excluded.prereqs,antireqs=excluded.antireqs,coreqs=excluded.coreqs,
useful_rating=excluded.useful_rating,liked_rating=excluded.liked_rating,easy_rating=excluded.easy_rating,num_ratings=excluded.num_ratings;
