-- Extend the category column to hold comma-separated multi-category values
ALTER TABLE rooms ALTER COLUMN category TYPE varchar(255);
