"""Infer over every source page in bounded requests, retaining all evidence."""
import json
from bs4 import BeautifulSoup


def infer_all_pages(html_pages, llm, build_prompt, parse_payload):
    entities = {}
    relationships = {}
    assumptions = []
    batch_count = 0
    for page_number, html in enumerate(html_pages, start=1):
        soup = BeautifulSoup(html, "html.parser")
        for element in soup(["script", "style", "noscript"]):
            element.decompose()
        evidence = str(soup)
        for start in range(0, len(evidence), 12000):
            batch_count += 1
            prompt = build_prompt([f"Source page {page_number}, offset {start}:\n" + evidence[start:start + 12000]])
            payload = None
            for attempt in range(3):
                payload = parse_payload(llm.invoke(prompt))
                if payload and isinstance(payload.get("entities"), list) and payload["entities"]:
                    break
                prompt += "\nReturn a valid schema object with nonempty entities and fields."
            if not payload or not payload.get("entities"):
                raise ValueError(f"Invalid schema response for page {page_number}, evidence offset {start}")
            for entity in payload["entities"]:
                if not isinstance(entity, dict) or not entity.get("name") or not entity.get("fields"):
                    raise ValueError(f"Invalid entity in schema evidence batch {batch_count}")
                key = entity["name"].casefold()
                if key not in entities:
                    entities[key] = entity
                else:
                    fields = {field["name"].casefold(): field for field in entities[key]["fields"]}
                    for field in entity["fields"]:
                        previous = fields.get(field["name"].casefold())
                        if previous and previous.get("type") != field.get("type"):
                            assumptions.append(f"Review conflicting types for {entity['name']}.{field['name']}")
                        elif not previous:
                            fields[field["name"].casefold()] = field
                    entities[key]["fields"] = list(fields.values())
            for relation in payload.get("relationships", []):
                key = (relation["source_entity"].casefold(), relation["target_entity"].casefold(), relation["relation_type"])
                relationships[key] = relation
            assumptions.extend(payload.get("assumptions", []))
    assumptions.append(f"Analyzed all {len(html_pages)} pages in {batch_count} evidence batches.")
    return json.dumps({"entities": list(entities.values()), "relationships": list(relationships.values()),
                       "assumptions": list(dict.fromkeys(assumptions))})
