-- STE-25 S2a: immutable, versioned source policy and optional evidence provenance.
-- Existing evidence documents remain unbound; writers opt into the sidecar.
CREATE TABLE IF NOT EXISTS theme_source_registry_versions (
  source_policy_version varchar(255) PRIMARY KEY,
  contract_version varchar(64) NOT NULL CHECK (contract_version = 'theme-source-registry-v1'),
  manifest jsonb NOT NULL CHECK ((jsonb_typeof(manifest) = 'object' AND jsonb_typeof(manifest->'entries') = 'array') IS TRUE),
  manifest_hash varchar(64) NOT NULL CHECK (manifest_hash ~ '^[a-f0-9]{64}$'),
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT uq_theme_source_registry_version_hash UNIQUE (source_policy_version, manifest_hash),
  CONSTRAINT theme_source_registry_manifest_version CHECK ((manifest->>'sourcePolicyVersion' = source_policy_version) IS TRUE),
  CONSTRAINT theme_source_registry_manifest_contract CHECK ((manifest->>'contractVersion' = contract_version) IS TRUE)
);

CREATE TABLE IF NOT EXISTS theme_evidence_document_sources (
  document_id uuid PRIMARY KEY REFERENCES theme_evidence_documents(id) ON DELETE RESTRICT,
  source_policy_version varchar(255) NOT NULL,
  registry_hash varchar(64) NOT NULL,
  entry_id varchar(255) NOT NULL,
  bound_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT fk_theme_evidence_document_sources_registry FOREIGN KEY (source_policy_version, registry_hash)
    REFERENCES theme_source_registry_versions(source_policy_version, manifest_hash) ON DELETE RESTRICT
);
CREATE INDEX IF NOT EXISTS idx_theme_evidence_document_sources_entry
  ON theme_evidence_document_sources (source_policy_version, entry_id);

CREATE OR REPLACE FUNCTION validate_theme_evidence_document_source() RETURNS trigger AS $$
DECLARE
  document theme_evidence_documents%ROWTYPE;
  entry jsonb;
  entry_count integer;
BEGIN
  SELECT * INTO document FROM theme_evidence_documents WHERE id = NEW.document_id;
  IF NOT FOUND THEN RAISE EXCEPTION 'evidence document missing' USING ERRCODE = '23503'; END IF;
  SELECT count(*), jsonb_agg(entries.value)->0 INTO entry_count, entry
    FROM theme_source_registry_versions registry,
         jsonb_array_elements(registry.manifest->'entries') AS entries(value)
    WHERE registry.source_policy_version = NEW.source_policy_version
      AND registry.manifest_hash = NEW.registry_hash
      AND entries.value->>'id' = NEW.entry_id;
  IF entry_count <> 1 OR document.source_policy_version IS DISTINCT FROM NEW.source_policy_version
     OR document.publisher_id IS DISTINCT FROM entry->>'publisherId'
     OR document.publisher IS DISTINCT FROM entry->>'publisherName'
     OR document.origin_group IS DISTINCT FROM entry->>'originGroup'
     OR document.source_class IS DISTINCT FROM entry->>'sourceClass' THEN
    RAISE EXCEPTION 'evidence document source provenance mismatch' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS theme_evidence_document_sources_validate ON theme_evidence_document_sources;
CREATE TRIGGER theme_evidence_document_sources_validate BEFORE INSERT ON theme_evidence_document_sources
  FOR EACH ROW EXECUTE FUNCTION validate_theme_evidence_document_source();

-- The 0009 function is intentionally reused to keep both tables append-only.
DROP TRIGGER IF EXISTS theme_source_registry_versions_immutable ON theme_source_registry_versions;
CREATE TRIGGER theme_source_registry_versions_immutable BEFORE UPDATE OR DELETE ON theme_source_registry_versions
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
DROP TRIGGER IF EXISTS theme_evidence_document_sources_immutable ON theme_evidence_document_sources;
CREATE TRIGGER theme_evidence_document_sources_immutable BEFORE UPDATE OR DELETE ON theme_evidence_document_sources
  FOR EACH ROW EXECUTE FUNCTION reject_theme_reliability_mutation();
