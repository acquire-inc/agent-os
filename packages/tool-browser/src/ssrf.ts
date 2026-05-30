// SSRF guard for tool.browser — brand-new security code, no in-repo analog.
//
// An agent instructed to "visit http://169.254.169.254/latest/meta-data/" would
// otherwise exfiltrate cloud credentials. assertUrlAllowed() is the single chokepoint
// every browser navigation must pass: it rejects non-http(s) schemes, then resolves
// the hostname via DNS (closing the DNS-rebinding hole where a public name maps to a
// private address) and checks EVERY resolved address against a BlockList of private,
// loopback, link-local, reserved, and cloud-metadata ranges.
import { lookup } from "node:dns/promises";
import { BlockList, isIP } from "node:net";

export const SSRF_BLOCK_REASONS = {
  SCHEME: "url scheme must be http or https",
  METADATA: "cloud metadata address is blocked",
  PRIVATE: "private/loopback/link-local/reserved address is blocked",
  LOCALHOST: "localhost is blocked",
  UNRESOLVABLE: "hostname did not resolve to any address",
} as const;

export class SsrfError extends Error {
  constructor(
    message: string,
    public readonly reason: (typeof SSRF_BLOCK_REASONS)[keyof typeof SSRF_BLOCK_REASONS],
  ) {
    super(message);
    this.name = "SsrfError";
  }
}

const LOCALHOST_ALIASES = new Set(["localhost", "localhost.localdomain", "ip6-localhost"]);
const METADATA_IPS = new Set(["169.254.169.254", "fd00:ec2::254"]);

function buildBlockList(): BlockList {
  const bl = new BlockList();
  // IPv4 private + loopback + link-local + reserved.
  bl.addSubnet("10.0.0.0", 8, "ipv4");
  bl.addSubnet("172.16.0.0", 12, "ipv4");
  bl.addSubnet("192.168.0.0", 16, "ipv4");
  bl.addSubnet("127.0.0.0", 8, "ipv4");
  bl.addSubnet("169.254.0.0", 16, "ipv4"); // link-local incl. 169.254.169.254
  bl.addSubnet("0.0.0.0", 8, "ipv4");
  bl.addSubnet("100.64.0.0", 10, "ipv4"); // carrier-grade NAT
  // IPv6 loopback + unique-local + link-local.
  bl.addAddress("::1", "ipv6");
  bl.addSubnet("fc00::", 7, "ipv6"); // unique local
  bl.addSubnet("fe80::", 10, "ipv6"); // link-local
  return bl;
}

const BLOCK_LIST = buildBlockList();

/** Throws SsrfError if the URL is not safe to navigate to. */
export async function assertUrlAllowed(url: string): Promise<void> {
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    throw new SsrfError(`invalid URL: ${url}`, SSRF_BLOCK_REASONS.SCHEME);
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new SsrfError(`blocked scheme ${parsed.protocol}`, SSRF_BLOCK_REASONS.SCHEME);
  }

  const host = parsed.hostname.replace(/^\[|\]$/g, ""); // strip IPv6 brackets

  if (LOCALHOST_ALIASES.has(host.toLowerCase())) {
    throw new SsrfError(`blocked localhost alias ${host}`, SSRF_BLOCK_REASONS.LOCALHOST);
  }

  // Collect candidate addresses: if the host is already a literal IP, check it
  // directly; otherwise resolve via DNS (rebinding guard) and check all answers.
  const addresses: { address: string; family: 4 | 6 }[] = [];
  const literalFamily = isIP(host);
  if (literalFamily === 4 || literalFamily === 6) {
    addresses.push({ address: host, family: literalFamily });
  } else {
    let resolved: { address: string; family: number }[];
    try {
      resolved = await lookup(host, { all: true });
    } catch {
      throw new SsrfError(`could not resolve ${host}`, SSRF_BLOCK_REASONS.UNRESOLVABLE);
    }
    if (resolved.length === 0) {
      throw new SsrfError(`no addresses for ${host}`, SSRF_BLOCK_REASONS.UNRESOLVABLE);
    }
    for (const r of resolved) addresses.push({ address: r.address, family: r.family === 6 ? 6 : 4 });
  }

  for (const { address, family } of addresses) {
    if (METADATA_IPS.has(address)) {
      throw new SsrfError(`blocked metadata IP ${address}`, SSRF_BLOCK_REASONS.METADATA);
    }
    const kind = family === 6 ? "ipv6" : "ipv4";
    if (BLOCK_LIST.check(address, kind)) {
      throw new SsrfError(
        `blocked private/reserved address ${address}`,
        SSRF_BLOCK_REASONS.PRIVATE,
      );
    }
  }
}
