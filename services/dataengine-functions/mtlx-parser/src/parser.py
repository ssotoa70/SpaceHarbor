"""MaterialX document parser for extracting material data.

Parses MaterialX (.mtlx) files and extracts material name, looks,
texture dependencies, render contexts, and spec version.
"""

import hashlib
from pathlib import Path
from typing import Any, Optional

try:
    import MaterialX as mx

    HAS_MATERIALX = True
except ImportError:
    HAS_MATERIALX = False


class MaterialXParser:
    """Parser for MaterialX documents."""

    def __init__(self) -> None:
        if not HAS_MATERIALX:
            raise ImportError(
                "MaterialX is not installed. Install via: pip install MaterialX>=1.38.8"
            )

    def parse_file(self, file_path: str) -> dict:
        """Parse a MaterialX document file and return structured data."""
        if not Path(file_path).exists():
            raise FileNotFoundError(f"MaterialX file not found: {file_path}")

        doc = mx.createDocument()
        mx.readFromXmlFile(doc, file_path)

        content_hash = self._calculate_hash(file_path)
        material_name = self._extract_material_name(doc, file_path)
        mtlx_spec_version = doc.getVersionString() or "1.38"
        usd_material_path = self._extract_usd_material_path(doc)
        render_contexts = self._extract_render_contexts(doc)
        looks = self._extract_looks(doc)
        textures = self._extract_textures(doc)

        return {
            "material_name": material_name,
            "content_hash": content_hash,
            "mtlx_spec_version": mtlx_spec_version,
            "usd_material_path": usd_material_path,
            "render_contexts": render_contexts,
            "looks": looks,
            "textures": textures,
        }

    def _calculate_hash(self, file_path: str) -> str:
        sha256 = hashlib.sha256()
        with open(file_path, "rb") as f:
            for chunk in iter(lambda: f.read(4096), b""):
                sha256.update(chunk)
        return f"sha256:{sha256.hexdigest()}"

    def _extract_material_name(self, doc: Any, file_path: str) -> str:
        try:
            for nd in doc.getNodeDefs():
                if nd.getNodeGroup() == "surfaceshader":
                    return nd.getName()
        except (AttributeError, TypeError):
            pass
        try:
            materials = doc.getMaterials()
            if materials:
                return materials[0].getName()
        except (AttributeError, IndexError, TypeError):
            pass
        return Path(file_path).stem

    def _extract_usd_material_path(self, doc: Any) -> Optional[str]:
        try:
            if hasattr(doc, "getAttribute"):
                val = doc.getAttribute("usdmaterialpath")
                if val:
                    return val.asString()
        except (AttributeError, TypeError):
            pass
        return None

    def _extract_render_contexts(self, doc: Any) -> list[str]:
        contexts: set[str] = set()
        try:
            for nd in doc.getNodeDefs():
                name = nd.getName().lower()
                if "arnold" in name or "standard_surface" in name:
                    contexts.add("arnold")
                if "usd" in name:
                    contexts.add("usd")
                if "rman" in name:
                    contexts.add("renderman")
                if "vray" in name:
                    contexts.add("vray")
        except (AttributeError, TypeError):
            pass
        return sorted(contexts) if contexts else ["usd"]

    def _extract_looks(self, doc: Any) -> list[dict]:
        looks = []
        try:
            for look in doc.getLooks():
                assigns = []
                try:
                    for assign in look.getMaterialAssigns():
                        mat = assign.getAttribute("material")
                        geom = assign.getAttribute("geom")
                        coll = assign.getAttribute("collection")
                        assigns.append({
                            "material": mat.asString() if mat else "",
                            "geometry": geom.asString() if geom else "",
                            "collection": coll.asString() if coll else "",
                        })
                except (AttributeError, TypeError):
                    pass
                looks.append({"name": look.getName(), "material_assigns": assigns})
        except (AttributeError, TypeError):
            pass
        return looks

    def _extract_textures(self, doc: Any) -> list[dict]:
        textures = []
        seen: set[str] = set()
        try:
            for ng in doc.getNodeGraphs():
                for node in ng.getNodes():
                    cat = node.getCategory()
                    if cat not in ("image", "tiledimage"):
                        continue
                    tex = self._extract_texture_from_node(node)
                    key = tex["texture_path"]
                    if key and key not in seen:
                        textures.append(tex)
                        seen.add(key)
        except (AttributeError, TypeError):
            pass
        return textures

    def _extract_texture_from_node(self, node: Any) -> dict:
        texture_path = self._get_input_value(node, "file") or self._get_input_value(node, "filename") or ""
        colorspace = self._get_input_value(node, "colorspace") or "raw"
        texture_type = self._infer_texture_type(node)
        content_hash = None
        if texture_path and Path(texture_path).exists():
            content_hash = self._calculate_hash(texture_path)
        return {
            "texture_path": texture_path,
            "content_hash": content_hash,
            "texture_type": texture_type,
            "colorspace": colorspace,
            "dependency_depth": 0,
        }

    def _get_input_value(self, node: Any, name: str) -> Optional[str]:
        try:
            inp = node.getInput(name)
            if inp:
                val = inp.getValue()
                return str(val) if val is not None else None
        except (AttributeError, TypeError):
            pass
        return None

    def _infer_texture_type(self, node: Any) -> str:
        try:
            name = node.getName().lower()
            for t in ["diffuse", "normal", "roughness", "metallic", "emission", "displacement", "specular"]:
                if t in name:
                    return t
        except (AttributeError, TypeError):
            pass
        return "unknown"


def parse_mtlx(file_path: str) -> dict:
    """Parse a MaterialX file (public API)."""
    return MaterialXParser().parse_file(file_path)
