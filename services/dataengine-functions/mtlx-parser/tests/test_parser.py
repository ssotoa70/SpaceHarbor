"""Unit tests for MaterialX parser (mock MaterialX library)."""

import os
import tempfile
import unittest
from unittest.mock import MagicMock, patch

from src.parser import MaterialXParser, parse_mtlx


def _make_doc(
    version="1.38",
    node_defs=None,
    materials=None,
    looks=None,
    node_graphs=None,
):
    doc = MagicMock()
    doc.getVersionString.return_value = version
    doc.getNodeDefs.return_value = node_defs or []
    doc.getMaterials.return_value = materials or []
    doc.getLooks.return_value = looks or []
    doc.getNodeGraphs.return_value = node_graphs or []
    doc.getAttribute.return_value = None
    return doc


class TestMaterialXParser(unittest.TestCase):
    def setUp(self):
        self.test_dir = tempfile.mkdtemp()
        self.test_file = os.path.join(self.test_dir, "test.mtlx")
        with open(self.test_file, "w") as f:
            f.write("<materialx></materialx>")

    def tearDown(self):
        os.remove(self.test_file)
        os.rmdir(self.test_dir)

    @patch("src.parser.mx")
    def test_basic_parse(self, mock_mx):
        mock_mx.createDocument.return_value = _make_doc()
        result = MaterialXParser().parse_file(self.test_file)
        assert "material_name" in result
        assert "content_hash" in result
        assert result["mtlx_spec_version"] == "1.38"
        assert isinstance(result["looks"], list)
        assert isinstance(result["textures"], list)

    @patch("src.parser.mx")
    def test_material_name_from_nodedef(self, mock_mx):
        nd = MagicMock()
        nd.getNodeGroup.return_value = "surfaceshader"
        nd.getName.return_value = "MyMaterial"
        mock_mx.createDocument.return_value = _make_doc(node_defs=[nd])
        result = MaterialXParser().parse_file(self.test_file)
        assert result["material_name"] == "MyMaterial"

    @patch("src.parser.mx")
    def test_material_name_fallback_to_filename(self, mock_mx):
        mock_mx.createDocument.return_value = _make_doc()
        result = MaterialXParser().parse_file(self.test_file)
        assert result["material_name"] == "test"

    @patch("src.parser.mx")
    def test_single_look(self, mock_mx):
        assign = MagicMock()
        assign.getAttribute.side_effect = lambda a: (
            MagicMock(asString=lambda: "mat1") if a == "material"
            else MagicMock(asString=lambda: "/geo") if a == "geom"
            else None
        )
        look = MagicMock()
        look.getName.return_value = "hero"
        look.getMaterialAssigns.return_value = [assign]
        mock_mx.createDocument.return_value = _make_doc(looks=[look])
        result = MaterialXParser().parse_file(self.test_file)
        assert len(result["looks"]) == 1
        assert result["looks"][0]["name"] == "hero"

    @patch("src.parser.mx")
    def test_multi_look(self, mock_mx):
        look1 = MagicMock()
        look1.getName.return_value = "hero"
        look1.getMaterialAssigns.return_value = []
        look2 = MagicMock()
        look2.getName.return_value = "crowd"
        look2.getMaterialAssigns.return_value = []
        mock_mx.createDocument.return_value = _make_doc(looks=[look1, look2])
        result = MaterialXParser().parse_file(self.test_file)
        assert len(result["looks"]) == 2
        assert result["looks"][0]["name"] == "hero"
        assert result["looks"][1]["name"] == "crowd"

    @patch("src.parser.mx")
    def test_texture_extraction(self, mock_mx):
        file_input = MagicMock()
        file_input.getValue.return_value = "/tex/diffuse.exr"
        node = MagicMock()
        node.getCategory.return_value = "image"
        node.getName.return_value = "diffuse_tex"
        node.getInput.side_effect = lambda n: file_input if n == "file" else None
        ng = MagicMock()
        ng.getNodes.return_value = [node]
        mock_mx.createDocument.return_value = _make_doc(node_graphs=[ng])
        result = MaterialXParser().parse_file(self.test_file)
        assert len(result["textures"]) == 1
        assert result["textures"][0]["texture_type"] == "diffuse"
        assert result["textures"][0]["colorspace"] == "raw"

    @patch("src.parser.mx")
    def test_texture_with_colorspace(self, mock_mx):
        file_input = MagicMock()
        file_input.getValue.return_value = "/tex/color.exr"
        cs_input = MagicMock()
        cs_input.getValue.return_value = "ACEScg"
        node = MagicMock()
        node.getCategory.return_value = "image"
        node.getName.return_value = "color_tex"
        node.getInput.side_effect = lambda n: (
            file_input if n == "file" else cs_input if n == "colorspace" else None
        )
        ng = MagicMock()
        ng.getNodes.return_value = [node]
        mock_mx.createDocument.return_value = _make_doc(node_graphs=[ng])
        result = MaterialXParser().parse_file(self.test_file)
        assert result["textures"][0]["colorspace"] == "ACEScg"

    @patch("src.parser.mx")
    def test_render_contexts_arnold(self, mock_mx):
        nd = MagicMock()
        nd.getName.return_value = "ND_standard_surface_surfaceshader"
        nd.getNodeGroup.return_value = "other"
        mock_mx.createDocument.return_value = _make_doc(node_defs=[nd])
        result = MaterialXParser().parse_file(self.test_file)
        assert "arnold" in result["render_contexts"]

    def test_content_hash_format(self):
        with patch("src.parser.mx"):
            parser = MaterialXParser()
            h = parser._calculate_hash(self.test_file)
            assert h.startswith("sha256:")
            assert len(h) == 71

    @patch("src.parser.mx")
    def test_no_looks(self, mock_mx):
        mock_mx.createDocument.return_value = _make_doc()
        result = MaterialXParser().parse_file(self.test_file)
        assert result["looks"] == []
        assert result["textures"] == []

    def test_file_not_found(self):
        with patch("src.parser.mx"):
            with self.assertRaises(FileNotFoundError):
                MaterialXParser().parse_file("/nonexistent/file.mtlx")

    @patch("src.parser.mx")
    def test_public_api(self, mock_mx):
        mock_mx.createDocument.return_value = _make_doc()
        result = parse_mtlx(self.test_file)
        assert isinstance(result, dict)
        assert "material_name" in result


if __name__ == "__main__":
    unittest.main()
