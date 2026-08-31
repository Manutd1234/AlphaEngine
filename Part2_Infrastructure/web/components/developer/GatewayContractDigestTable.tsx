interface GatewayContractDigestRow {
  source: string;
  hex: string | null;
  glyph: string;
  word: string;
  tint: string;
  evidence: string;
}

/**
 * The two sides of the gateway contract comparison, aligned as evidence rather
 * than stacked as unrelated notices. The glyph and state word carry every
 * verdict; colour only reinforces it.
 */
export default function GatewayContractDigestTable({
  rows,
}: {
  rows: GatewayContractDigestRow[];
}) {
  return (
    <div className="gateway-contract-digests" tabIndex={0}>
      <table>
        <caption className="sr-only">Committed and live gateway OpenAPI digests</caption>
        <colgroup>
          <col className="gateway-contract-digests__source" />
          <col className="gateway-contract-digests__digest" />
          <col className="gateway-contract-digests__state" />
          <col className="gateway-contract-digests__evidence" />
        </colgroup>
        <thead>
          <tr>
            <th scope="col">Source</th>
            <th scope="col">SHA-256 digest</th>
            <th scope="col">State</th>
            <th scope="col">Evidence</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.source}>
              <th scope="row">{row.source}</th>
              <td>
                {row.hex === null ? (
                  <span aria-label="No digest observed">—</span>
                ) : (
                  <code className="num" title={row.hex}>{row.hex}</code>
                )}
              </td>
              <td>
                <strong style={{ color: row.tint }}>
                  <span aria-hidden>{row.glyph}</span> {row.word}
                </strong>
              </td>
              <td>{row.evidence}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
