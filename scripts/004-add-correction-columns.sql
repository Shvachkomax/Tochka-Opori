alter table case_reviews
add column if not exists doctor_correction jsonb;

alter table case_reviews
add column if not exists corrected_json jsonb;

alter table case_reviews
add column if not exists protocol_update text;

alter table case_reviews
add column if not exists correction_comment text;
