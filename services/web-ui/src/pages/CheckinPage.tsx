/**
 * Standalone check-in page — wraps CheckinDropZone as a full page so
 * users can link/bookmark the flow. Nav: Library → Check In.
 */
import { useNavigate } from "react-router-dom";
import { CheckinDropZone } from "../components/checkin/CheckinDropZone";

export function CheckinPage() {
  const navigate = useNavigate();
  return (
    <CheckinDropZone
      onClose={() => navigate(-1)}
      onComplete={(result) => navigate(`/library/assets/${result.versionId}`)}
    />
  );
}
