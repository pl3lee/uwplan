package course

import "github.com/google/uuid"

// Course retains catalog identity and the information shown in planning views.
type Course struct {
	ID                                                 uuid.UUID
	Code, Name, Description, Prereqs, Antireqs, Coreqs string
	UsefulRating, LikedRating, EasyRating              *string
	NumRatings                                         *int32
}
