"""
Tests for rescue_logs endpoint and data structure.

Run with: python -m pytest training/peft/test_rescue_logs.py -v
"""
import pytest
from fastapi.testclient import TestClient
from unittest.mock import MagicMock, patch
import uuid


# Mock Supabase before importing the app
@pytest.fixture(autouse=True)
def mock_supabase():
    """Mock Supabase client for all tests."""
    with patch.dict('os.environ', {
        'SUPABASE_URL': 'https://test.supabase.co',
        'SUPABASE_SERVICE_ROLE_KEY': 'test-key'
    }):
        with patch('slack_api.supabase') as mock_supa:
            with patch('slack_api.USE_SUPABASE', True):
                yield mock_supa


@pytest.fixture
def client(mock_supabase):
    """Create test client."""
    from slack_api import app
    return TestClient(app)


class TestRescueLogValidation:
    """Tests for /rescue-log endpoint validation."""

    def test_valid_rescue_log(self, client, mock_supabase):
        """Valid rescue log should be accepted."""
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
            data=[{"id": str(uuid.uuid4())}]
        )

        payload = {
            "location": "Aldi Wicker Park",
            "rescued_at": "2024-01-04",
            "items": [
                {"name": "Apples", "quantity": 2, "unit": "cs"},
                {"name": "Bread", "quantity": 10, "unit": "loaves"}
            ],
            "photo_urls": []
        }

        response = client.post("/rescue-log", json=payload)
        assert response.status_code == 200
        assert response.json()["status"] == "ok"
        assert "id" in response.json()

    def test_missing_location_rejected(self, client):
        """Rescue log without location should be rejected."""
        payload = {
            "rescued_at": "2024-01-04",
            "items": [{"name": "Apples", "quantity": 2, "unit": "cs"}]
        }

        response = client.post("/rescue-log", json=payload)
        assert response.status_code == 400
        assert "location" in response.json()["detail"].lower()

    def test_empty_location_rejected(self, client):
        """Rescue log with empty location should be rejected."""
        payload = {
            "location": "",
            "rescued_at": "2024-01-04",
            "items": [{"name": "Apples", "quantity": 2, "unit": "cs"}]
        }

        response = client.post("/rescue-log", json=payload)
        assert response.status_code == 400
        assert "location" in response.json()["detail"].lower()

    def test_missing_rescued_at_rejected(self, client):
        """Rescue log without rescued_at date should be rejected."""
        payload = {
            "location": "Aldi Wicker Park",
            "items": [{"name": "Apples", "quantity": 2, "unit": "cs"}]
        }

        response = client.post("/rescue-log", json=payload)
        assert response.status_code == 400
        assert "rescued_at" in response.json()["detail"].lower()

    def test_items_must_be_array(self, client):
        """Items field must be an array."""
        payload = {
            "location": "Aldi Wicker Park",
            "rescued_at": "2024-01-04",
            "items": "not an array"
        }

        response = client.post("/rescue-log", json=payload)
        assert response.status_code == 400
        assert "array" in response.json()["detail"].lower()

    def test_empty_items_allowed(self, client, mock_supabase):
        """Empty items array should be allowed."""
        mock_supabase.table.return_value.insert.return_value.execute.return_value = MagicMock(
            data=[{"id": str(uuid.uuid4())}]
        )

        payload = {
            "location": "Aldi Wicker Park",
            "rescued_at": "2024-01-04",
            "items": []
        }

        response = client.post("/rescue-log", json=payload)
        assert response.status_code == 200


class TestRescueLogDataStructure:
    """Tests for rescue_logs data structure expectations."""

    def test_item_structure(self, client, mock_supabase):
        """Items should have expected structure with weight estimation."""
        captured_data = {}

        def capture_insert(data):
            captured_data.update(data)
            mock_result = MagicMock()
            mock_result.execute.return_value = MagicMock(data=[{"id": str(uuid.uuid4())}])
            return mock_result

        mock_supabase.table.return_value.insert.side_effect = capture_insert

        payload = {
            "location": "Aldi Wicker Park",
            "rescued_at": "2024-01-04",
            "items": [
                {"name": "Apples", "quantity": 2, "unit": "cs"},
                {"name": "Bread", "quantity": 10, "unit": "loaves"}
            ]
        }

        response = client.post("/rescue-log", json=payload)
        assert response.status_code == 200

        # Verify data structure passed to Supabase
        assert captured_data["location"] == "Aldi Wicker Park"
        assert captured_data["rescued_at"] == "2024-01-04"
        assert isinstance(captured_data["items"], list)
        assert len(captured_data["items"]) == 2

        # Each item should have name, quantity, unit
        for item in captured_data["items"]:
            assert "name" in item
            assert "quantity" in item or item.get("quantity") is None
            assert "unit" in item or item.get("unit") is None

    def test_total_lbs_calculated(self, client, mock_supabase):
        """Total estimated lbs should be calculated from items."""
        captured_data = {}

        def capture_insert(data):
            captured_data.update(data)
            mock_result = MagicMock()
            mock_result.execute.return_value = MagicMock(data=[{"id": str(uuid.uuid4())}])
            return mock_result

        mock_supabase.table.return_value.insert.side_effect = capture_insert

        payload = {
            "location": "Aldi Wicker Park",
            "rescued_at": "2024-01-04",
            "items": [
                {"name": "Apples", "quantity": 2, "unit": "cs", "estimated_lbs": 40},
                {"name": "Bread", "quantity": 10, "unit": "loaves", "estimated_lbs": 15}
            ]
        }

        response = client.post("/rescue-log", json=payload)
        assert response.status_code == 200

        # Total should be sum of item weights
        assert captured_data["total_estimated_lbs"] == 55.0

    def test_photo_urls_stored(self, client, mock_supabase):
        """Photo URLs should be stored as JSONB array."""
        captured_data = {}

        def capture_insert(data):
            captured_data.update(data)
            mock_result = MagicMock()
            mock_result.execute.return_value = MagicMock(data=[{"id": str(uuid.uuid4())}])
            return mock_result

        mock_supabase.table.return_value.insert.side_effect = capture_insert

        payload = {
            "location": "Aldi Wicker Park",
            "rescued_at": "2024-01-04",
            "items": [],
            "photo_urls": ["https://example.com/photo1.jpg", "https://example.com/photo2.jpg"]
        }

        response = client.post("/rescue-log", json=payload)
        assert response.status_code == 200

        assert captured_data["photo_urls"] == ["https://example.com/photo1.jpg", "https://example.com/photo2.jpg"]


class TestLoadAuditedWithRescueLogs:
    """Tests for load_audited() reading from rescue_logs."""

    def test_rescue_logs_normalized_for_stats(self, mock_supabase):
        """Rescue logs should be normalized to match stats format."""
        from slack_api import load_audited

        # Mock slack_messages_audited (empty)
        slack_response = MagicMock()
        slack_response.data = []

        # Mock rescue_logs with sample data
        rescue_response = MagicMock()
        rescue_response.data = [{
            "id": "test-uuid-123",
            "location": "Aldi Wicker Park",
            "rescued_at": "2024-01-04",
            "items": [
                {"name": "Apples", "quantity": 2, "unit": "cs", "estimated_lbs": 40}
            ],
            "total_estimated_lbs": 40.0,
            "photo_urls": ["https://example.com/photo.jpg"],
            "created_at": "2024-01-04T12:00:00Z"
        }]

        def mock_select(*args, **kwargs):
            mock_chain = MagicMock()
            return mock_chain

        def mock_table(table_name):
            mock_t = MagicMock()
            if table_name == "slack_messages_audited":
                mock_t.select.return_value.execute.return_value = slack_response
            else:
                mock_t.select.return_value.execute.return_value = rescue_response
            return mock_t

        mock_supabase.table.side_effect = mock_table

        records = load_audited()

        assert len(records) == 1
        record = records[0]

        # Check normalized structure
        assert record["id"] == "rescue-test-uuid-123"
        assert record["source"] == "rescue_logs"
        assert record["rescue_location_canonical"] == "Aldi Wicker Park"
        assert record["total_estimated_lbs"] == 40.0
        assert record["audited"] == True
        assert record["recurring"] == False

        # Check sections structure for stats
        assert len(record["sections"]) == 1
        assert record["sections"][0]["location_canonical"] == "Aldi Wicker Park"
        assert len(record["sections"][0]["items"]) == 1
