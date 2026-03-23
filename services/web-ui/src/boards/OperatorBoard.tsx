import type { FormEvent } from "react";

import type { AssetRow } from "../api";

interface OperatorBoardProps {
  title: string;
  sourceUri: string;
  assets: AssetRow[];
  onTitleChange: (value: string) => void;
  onSourceUriChange: (value: string) => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onReplay: (jobId: string) => void;
}

export function OperatorBoard({
  title,
  sourceUri,
  assets,
  onTitleChange,
  onSourceUriChange,
  onSubmit,
  onReplay
}: OperatorBoardProps) {
  return (
    <>
      <section className="panel" aria-labelledby="ingest-heading">
        <h2 id="ingest-heading">Ingest</h2>
        <form onSubmit={onSubmit} className="ingest-form">
          <label>
            Title
            <input value={title} onChange={(event) => onTitleChange(event.target.value)} name="title" />
          </label>
          <label>
            Source URI
            <input value={sourceUri} onChange={(event) => onSourceUriChange(event.target.value)} name="sourceUri" />
          </label>
          <button type="submit">Register Asset</button>
        </form>
      </section>

      <section className="panel" aria-labelledby="queue-heading">
        <h2 id="queue-heading">Assets Queue</h2>
        <table>
          <thead>
            <tr>
              <th scope="col">Title</th>
              <th scope="col">Source</th>
              <th scope="col">Status</th>
              <th scope="col">Actions</th>
            </tr>
          </thead>
          <tbody>
            {assets.length === 0 ? (
              <tr>
                <td colSpan={4}>No assets yet.</td>
              </tr>
            ) : (
              assets.map((asset) => (
                <tr key={asset.id}>
                  <td>{asset.title}</td>
                  <td>{asset.sourceUri}</td>
                  <td>
                    <span className={`status status-${asset.status}`}>{asset.status}</span>
                  </td>
                  <td>
                    {asset.status === "failed" && asset.jobId ? (
                      <button type="button" onClick={() => onReplay(asset.jobId ?? "")}>
                        Replay
                      </button>
                    ) : (
                      <span>-</span>
                    )}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </section>
    </>
  );
}
