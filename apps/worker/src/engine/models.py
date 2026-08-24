from __future__ import annotations

from dataclasses import dataclass, field
from enum import Enum
from typing import Any


class JobStatus(str, Enum):
    DRAFT = "draft"
    CRAWLED = "crawled"
    EXTRACTED = "extracted"
    INFERRING_SCHEMA = "inferring_schema"
    SCHEMA_PROPOSED = "schema_proposed"
    AWAITING_APPROVAL = "awaiting_approval"
    APPROVED = "approved"
    GENERATED = "generated"
    VALIDATED = "validated"
    CANCELLED = "cancelled"
    FAILED = "failed"


@dataclass
class FieldCandidate:
    name: str
    data_type: str
    confidence: float
    evidence: list[str] = field(default_factory=list)


@dataclass
class EntityCandidate:
    name: str
    fields: list[FieldCandidate] = field(default_factory=list)
    confidence: float = 0.0


@dataclass
class RelationshipCandidate:
    source_entity: str
    target_entity: str
    relation_type: str
    confidence: float
    evidence: list[str] = field(default_factory=list)


@dataclass
class SchemaProposal:
    entities: list[EntityCandidate] = field(default_factory=list)
    relationships: list[RelationshipCandidate] = field(default_factory=list)
    assumptions: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "entities": [
                {
                    "name": entity.name,
                    "confidence": entity.confidence,
                    "fields": [
                        {
                            "name": field.name,
                            "type": field.data_type,
                            "confidence": field.confidence,
                            "evidence": field.evidence,
                        }
                        for field in entity.fields
                    ],
                }
                for entity in self.entities
            ],
            "relationships": [
                {
                    "source_entity": relation.source_entity,
                    "target_entity": relation.target_entity,
                    "relation_type": relation.relation_type,
                    "confidence": relation.confidence,
                    "evidence": relation.evidence,
                }
                for relation in self.relationships
            ],
            "assumptions": self.assumptions,
        }
