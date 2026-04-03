import { useNavigate } from "react-router-dom";
import { Card, Button } from "../../design-system";

export function ConnectionBanner() {
  const navigate = useNavigate();

  return (
    <Card className="px-5 py-6 text-center max-w-lg mx-auto mt-12">
      <div className="text-[var(--color-ah-warning)] text-2xl mb-2">&#9888;</div>
      <h2 className="text-sm font-semibold mb-1">VAST DataEngine Not Configured</h2>
      <p className="text-xs text-[var(--color-ah-text-muted)] mb-4 max-w-sm mx-auto">
        To manage DataEngine functions, triggers, and pipelines, configure the VMS URL and credentials in Settings.
      </p>
      <Button
        variant="secondary"
        onClick={() => navigate("/admin/settings")}
      >
        Go to Settings
      </Button>
    </Card>
  );
}
