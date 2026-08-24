---
config:
  flowchart:
    curve: linear
---
graph TD;
	__start__([<p>__start__</p>]):::first
	crawl_site(crawl_site)
	sitemap_gate(sitemap_gate)
	extract_content(extract_content)
	infer_candidates(infer_candidates)
	infer_schema(infer_schema)
	schema_review_gate(schema_review_gate)
	mint_schema_version(mint_schema_version)
	generation_gate(generation_gate)
	prepare_template_scaffold(prepare_template_scaffold)
	generate_backend(generate_backend)
	generate_frontend(generate_frontend)
	generate_admin(generate_admin)
	validate_consistency(validate_consistency)
	validate_build_smoke(validate_build_smoke)
	validation_review_gate(validation_review_gate)
	package_export(package_export)
	END_CANCELLED(END_CANCELLED)
	__end__([<p>__end__</p>]):::last
	__start__ --> crawl_site;
	crawl_site -.-> END_CANCELLED;
	crawl_site -.-> sitemap_gate;
	extract_content -.-> END_CANCELLED;
	extract_content -.-> infer_candidates;
	generate_admin --> validate_consistency;
	generate_backend --> generate_frontend;
	generate_frontend --> generate_admin;
	generation_gate -.-> END_CANCELLED;
	generation_gate -.-> prepare_template_scaffold;
	infer_candidates --> infer_schema;
	infer_schema --> schema_review_gate;
	mint_schema_version --> generation_gate;
	prepare_template_scaffold --> generate_backend;
	schema_review_gate -.-> END_CANCELLED;
	schema_review_gate -.-> infer_schema;
	schema_review_gate -.-> mint_schema_version;
	sitemap_gate -.-> crawl_site;
	sitemap_gate -.-> extract_content;
	validate_build_smoke --> validation_review_gate;
	validate_consistency --> validate_build_smoke;
	validation_review_gate -.-> END_CANCELLED;
	validation_review_gate -.-> generate_backend;
	validation_review_gate -.-> infer_schema;
	validation_review_gate -.-> package_export;
	END_CANCELLED --> __end__;
	package_export --> __end__;
	classDef default fill:#f2f0ff,line-height:1.2
	classDef first fill-opacity:0
	classDef last fill:#bfb6fc

