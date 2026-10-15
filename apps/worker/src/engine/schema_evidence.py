"""Compact schema-only evidence; never modify the captured source or assets."""
import hashlib
import json
import logging
import math
import re
from concurrent.futures import ThreadPoolExecutor, as_completed
from pathlib import Path
from threading import RLock

from bs4 import BeautifulSoup, Comment

from src.engine.failover_llm import FailoverLLM


def semantic_evidence(html):
    soup = BeautifulSoup(html, "html.parser")
    for comment in soup.find_all(string=lambda text: isinstance(text, Comment)):
        comment.extract()
    for element in list(soup.find_all(True)):
        if element.parent is None:
            continue
        if element.name in {"style", "noscript"} or (element.name == "script" and
                element.get("type") != "application/ld+json"):
            element.decompose()
            continue
        for key, value in list(element.attrs.items()):
            keep = key in {"id", "class", "href", "src", "srcset", "alt", "title", "name", "type",
                           "value", "placeholder", "content", "property", "itemprop", "itemtype", "datetime",
                           "role", "action", "poster", "for"} or key.startswith("aria-") or (
                key.startswith("data-") and not key.startswith(("data-w-", "data-wf-", "data-aos", "data-gsap")))
            if key == "style" and "url(" in str(value):
                keep = True
            if not keep:
                del element.attrs[key]
            elif isinstance(value, str) and value.startswith("data:"):
                element.attrs[key] = value.split(",", 1)[0] + ",[embedded media retained in capture]"
        if element.name in {"path", "rect", "circle", "ellipse", "polygon", "polyline", "line", "use"} and not element.get_text(strip=True) and not element.get("aria-label"):
            element.decompose()
    for element in reversed(list(soup.find_all(["div", "span"]))):
        if not element.attrs:
            element.unwrap()
    return re.sub(r"\s+", " ", str(soup)).strip()


def plan_evidence(html_pages, max_chars=12000, extra_evidence=()):
    """Pack every page/context fragment, deduplicating only identical evidence."""
    if max_chars < 1000:
        raise ValueError("Schema evidence batch size must be at least 1000 characters")
    soups = [BeautifulSoup(semantic_evidence(html), "html.parser") for html in html_pages]
    shared_candidates = {}
    for number, soup in enumerate(soups, 1):
        for element in soup.find_all(["header", "footer", "nav", "aside", "section", "div", "article", "form"]):
            text = str(element)
            if len(text) >= 500:
                shared_candidates.setdefault(text, set()).add(number)
    shared, unique = {}, {}
    for number, soup in enumerate(soups, 1):
        # Replace only exact shared subtrees. Their full evidence is sent once,
        # with explicit page references, rather than repeated on every page.
        for element in list(soup.find_all(["header", "footer", "nav", "aside", "section", "div", "article", "form"])):
            if element.parent is None or element.find_parent("shared-evidence"):
                continue
            text = str(element)
            if len(shared_candidates.get(text, ())) < 2:
                continue
            key = hashlib.sha256(text.encode()).hexdigest()[:16]
            record = shared.setdefault(key, {"text": text, "pages": []})
            record["pages"].append(number)
            element.replace_with(soup.new_tag("shared-evidence", attrs={"ref": key}))
            element.decompose()
        evidence = str(soup) or "[Empty source page]"
        unique.setdefault(evidence, []).append(number)
    fragments = []
    for evidence, pages in unique.items():
        label = "Source pages " + ", ".join(map(str, pages))
        for start in range(0, len(evidence), max_chars):
            fragments.append((pages, f"{label}, offset {start}:\n{evidence[start:start + max_chars]}"))
    for key, record in shared.items():
        pages = sorted(set(record["pages"]))
        for start in range(0, len(record["text"]), max_chars):
            fragments.append((pages, f"Shared evidence {key}, source pages {pages}, offset {start}:\n" + record["text"][start:start + max_chars]))
    for block in dict.fromkeys(extra_evidence):
        for start in range(0, len(block), max_chars):
            fragments.append(([], block[start:start + max_chars]))
    batches = []
    for pages, text in fragments:
        while text:
            if not batches or max_chars - len(batches[-1]["text"]) < 100:
                batches.append({"pages": [], "text": ""})
            batch = batches[-1]
            batch["pages"] = sorted(set(batch["pages"] + pages))
            prefix = "\n\n" if batch["text"] else ""
            available = max_chars - len(batch["text"]) - len(prefix)
            batch["text"] += prefix + text[:available]
            text = text[available:]
            if text:
                text = f"Continuation, source pages {pages}:\n" + text
    return batches


def _valid_payload(payload):
    def valid_confidence_and_evidence(candidate):
        confidence = candidate.get("confidence", 0) or 0
        evidence = candidate.get("evidence", [])
        return isinstance(confidence, (int, float)) and math.isfinite(confidence) and isinstance(evidence, list) and all(isinstance(clue, str) for clue in evidence)

    if not isinstance(payload, dict) or not isinstance(payload.get("entities"), list):
        return False
    for entity in payload["entities"]:
        if not isinstance(entity, dict) or not isinstance(entity.get("name"), str) or not entity["name"].strip() or not isinstance(entity.get("fields"), list) or not entity["fields"] or not valid_confidence_and_evidence(entity):
            return False
        for field in entity["fields"]:
            if not isinstance(field, dict) or not isinstance(field.get("name"), str) or not field["name"].strip() or not isinstance(field.get("type"), str) or not field["type"].strip() or not valid_confidence_and_evidence(field):
                return False
    relations = payload.get("relationships", [])
    assumptions = payload.get("assumptions", [])
    return isinstance(relations, list) and all(isinstance(relation, dict) and valid_confidence_and_evidence(relation) and all(
        isinstance(relation.get(key), str) and relation[key].strip()
        for key in ("source_entity", "target_entity", "relation_type")) for relation in relations) and isinstance(assumptions, list) and all(isinstance(item, str) for item in assumptions)


def _merge_payloads(payloads):
    entities, relationships, assumptions = {}, {}, []
    # Source order, not response timing, determines conflict resolution.
    for index in sorted(payloads):
        payload = payloads[index]
        for entity in payload["entities"]:
            key = entity["name"].casefold()
            if key not in entities:
                entities[key] = {**entity, "fields": list(entity["fields"])}
                continue
            fields = {field["name"].casefold(): field for field in entities[key]["fields"]}
            for field in entity["fields"]:
                previous = fields.get(field["name"].casefold())
                if previous and previous.get("type") != field.get("type"):
                    assumptions.append(f"Review conflicting types for {entity['name']}.{field['name']}")
                elif not previous:
                    fields[field["name"].casefold()] = field
            entities[key]["fields"] = list(fields.values())
        for relation in payload.get("relationships", []):
            key = tuple(relation[name].casefold() for name in ("source_entity", "target_entity", "relation_type"))
            relationships.setdefault(key, relation)
        assumptions.extend(payload.get("assumptions", []))
    return {"entities": list(entities.values()), "relationships": list(relationships.values()),
            "assumptions": list(dict.fromkeys(assumptions))}


def infer_all_pages(html_pages, llm, build_prompt, parse_payload, on_progress=None, *,
                    max_chars=12000, concurrency=2, extra_evidence=(), cache_dir=None):
    batches = plan_evidence(html_pages, max_chars, extra_evidence)
    completed, cached = {}, set()
    lock = RLock()

    def report(message, **details):
        with lock:
            merged = _merge_payloads(completed)
            if on_progress:
                on_progress({"total_batches": len(batches), "completed_batches": len(completed),
                             "page_count": len(html_pages), "entity_count": len(merged["entities"]),
                             "field_count": sum(len(entity["fields"]) for entity in merged["entities"]),
                             "cached_batches": len(cached), "message": message, **details})

    def infer(index, batch):
        context = {"batch_number": index + 1, "page_number": batch["pages"][0] if batch["pages"] else 0,
                   "source_pages": batch["pages"]}
        report(f"Analyzing evidence batch {index + 1}/{len(batches)}.", **context)
        prompt = build_prompt([batch["text"]])
        cache_file = Path(cache_dir) / (hashlib.sha256(prompt.encode()).hexdigest() + ".json") if cache_dir else None
        payload = None
        if cache_file and cache_file.is_file():
            try:
                candidate = json.loads(cache_file.read_text())
                if _valid_payload(candidate):
                    payload = candidate
                    with lock:
                        cached.add(index)
            except (OSError, ValueError):
                pass
        if payload is None:
            for attempt in range(3):
                if isinstance(llm, FailoverLLM):
                    response = llm.invoke(prompt, on_event=lambda event: report(event["message"], **context, provider=event["provider"]))
                else:
                    response = llm.invoke(prompt)
                payload = parse_payload(response)
                if _valid_payload(payload):
                    break
                payload = None
                prompt += "\nReturn valid schema JSON. Empty entities is allowed only for evidence with no content models."
            if payload is None:
                raise ValueError(f"Invalid schema response for evidence batch {index + 1}")
            if cache_file:
                try:
                    cache_file.parent.mkdir(parents=True, exist_ok=True)
                    temporary = cache_file.with_suffix(".tmp")
                    temporary.write_text(json.dumps(payload))
                    temporary.replace(cache_file)
                except OSError:
                    logging.warning("Unable to save schema evidence cache; conversion can continue")
        with lock:
            completed[index] = payload
            report(f"Completed evidence batch {index + 1}/{len(batches)}.", **context)

    with ThreadPoolExecutor(max_workers=max(1, min(4, concurrency))) as pool:
        futures = [pool.submit(infer, index, batch) for index, batch in enumerate(batches)]
        try:
            for future in as_completed(futures):
                future.result()
        except Exception:
            for future in futures:
                future.cancel()
            raise
    result = _merge_payloads(completed)
    result["assumptions"].append(f"Analyzed all {len(html_pages)} pages in {len(batches)} evidence batches.")
    return json.dumps(result)
