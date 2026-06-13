import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { ClipboardCopy, CheckCircle2, AlertCircle } from "lucide-react";
import { Page, PageHeader } from "#/components/shell/page";
import { Badge } from "#/components/ui/badge";
import { Button } from "#/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "#/components/ui/card";
import { Input } from "#/components/ui/misc";
import {
  composeArchitectPromptClient,
  ONBOARDING_STEPS,
  slugifyCompany,
  validateInterviewClient,
  type ClientInterview,
} from "#/lib/onboarding-client";

export const Route = createFileRoute("/_app/onboard")({ component: OnboardPage });

function OnboardPage() {
  const [iv, setIv] = useState<ClientInterview>({
    companyName: "",
    description: "",
    industry: "",
    goals: "",
    connectorsInUse: [],
    monthlyBudgetUsd: null,
    craAcknowledgement: "needs_review",
  });
  const [budgetText, setBudgetText] = useState("");
  const [connectorsText, setConnectorsText] = useState("");
  const [reviewed, setReviewed] = useState(false);

  const update = <K extends keyof ClientInterview>(k: K, v: ClientInterview[K]) =>
    setIv((prev) => ({ ...prev, [k]: v }));

  const ivWithDerivations: ClientInterview = {
    ...iv,
    tenantSlug: iv.tenantSlug ?? slugifyCompany(iv.companyName),
    connectorsInUse: connectorsText
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    monthlyBudgetUsd: budgetText.trim() === "" ? null : Number(budgetText),
  };

  const validation = validateInterviewClient(ivWithDerivations);
  const canReview = validation.ok;

  return (
    <Page>
      <PageHeader
        title="Onboard a tenant"
        description="The Viktor flow — interview → Architect → fleet. Validates as you type; CRA-territory keywords require explicit confirmation."
      />

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* Left: interview form */}
        <Card>
          <CardHeader>
            <CardTitle>Interview</CardTitle>
            <CardDescription>Fill this in for the new tenant.</CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <Field label="Company name">
              <Input value={iv.companyName} onChange={(e) => update("companyName", e.target.value)} placeholder="Northwind Marketing" />
            </Field>
            <Field label="Tenant slug" helper={`Auto-derived as: ${ivWithDerivations.tenantSlug || "(enter a company name)"}`}>
              <Input value={iv.tenantSlug ?? ""} onChange={(e) => update("tenantSlug", e.target.value || undefined)} placeholder="northwind-marketing" />
            </Field>
            <Field label="Industry">
              <Input value={iv.industry} onChange={(e) => update("industry", e.target.value)} placeholder="marketing, dtc" />
            </Field>
            <Field label="What the business does" helper="One paragraph; at least 20 characters">
              <textarea
                className="block w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={iv.description}
                onChange={(e) => update("description", e.target.value)}
              />
            </Field>
            <Field label="90-day goals" helper="What does success look like in 90 days?">
              <textarea
                className="block w-full min-h-[80px] rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={iv.goals}
                onChange={(e) => update("goals", e.target.value)}
              />
            </Field>
            <Field label="Connectors in use" helper="Comma-separated. Examples: pipeboard-meta, slack, close">
              <Input value={connectorsText} onChange={(e) => setConnectorsText(e.target.value)} placeholder="pipeboard-meta, slack, close" />
            </Field>
            <Field label="Monthly budget (USD)" helper="Leave blank = uncapped (operator review)">
              <Input
                type="number"
                value={budgetText}
                onChange={(e) => setBudgetText(e.target.value)}
                placeholder="500"
              />
            </Field>
            <Field label="CRA acknowledgement" helper="Required when CRA trigger keywords detected">
              <select
                className="block w-full rounded-md border border-input bg-background px-3 py-2 text-sm"
                value={iv.craAcknowledgement}
                onChange={(e) =>
                  update("craAcknowledgement", e.target.value as ClientInterview["craAcknowledgement"])
                }
              >
                <option value="needs_review">Needs review (default)</option>
                <option value="confirmed_not_eligibility_decisioning">
                  Confirmed: not eligibility decisioning
                </option>
              </select>
            </Field>
          </CardContent>
        </Card>

        {/* Right: validation + architect prompt + plan */}
        <div className="space-y-5">
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                {canReview ? <CheckCircle2 className="size-5 text-success" /> : <AlertCircle className="size-5 text-warning" />}
                Validation
              </CardTitle>
            </CardHeader>
            <CardContent>
              {validation.ok ? (
                <p className="text-sm text-muted-foreground">All checks pass. Review the prompt and plan below.</p>
              ) : (
                <ul className="space-y-1 text-sm text-destructive">
                  {validation.reasons.map((r, i) => (
                    <li key={i}>• {r}</li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <CardTitle>Architect prompt</CardTitle>
                {canReview && (
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => navigator.clipboard?.writeText(composeArchitectPromptClient(ivWithDerivations))}
                  >
                    <ClipboardCopy className="size-4" /> Copy
                  </Button>
                )}
              </div>
              <CardDescription>
                Deterministic — same interview always produces the same prompt. Send to{" "}
                <code className="rounded bg-muted px-1">POST /api/admin/architect/propose</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              {canReview ? (
                <pre className="max-h-72 overflow-auto whitespace-pre-wrap rounded bg-muted p-3 text-xs">
                  {composeArchitectPromptClient(ivWithDerivations)}
                </pre>
              ) : (
                <p className="text-sm text-muted-foreground">Fix validation errors to generate the prompt.</p>
              )}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Onboarding plan</CardTitle>
              <CardDescription>
                9 steps. Human-gated items pause for your review. Same order as <code className="rounded bg-muted px-1">pnpm tenant:new</code>.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <ol className="space-y-2">
                {ONBOARDING_STEPS.map((s, i) => (
                  <li key={s.kind} className="flex items-start gap-2 text-sm">
                    <span className="w-5 text-right text-muted-foreground">{i + 1}.</span>
                    <div>
                      <p>
                        {s.description}{" "}
                        {s.humanGated && (
                          <Badge variant="warning" className="ml-1 text-[10px]">human</Badge>
                        )}
                      </p>
                    </div>
                  </li>
                ))}
              </ol>
              <div className="mt-4 flex items-center gap-2">
                <Button disabled={!canReview} onClick={() => setReviewed(true)}>
                  {reviewed ? "Plan acknowledged" : "Acknowledge plan"}
                </Button>
                {reviewed && (
                  <span className="text-xs text-muted-foreground">
                    Now copy the Architect prompt above and call the API, OR run{" "}
                    <code className="rounded bg-muted px-1">pnpm tenant:new --json '...'</code>.
                  </span>
                )}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </Page>
  );
}

function Field({ label, helper, children }: { label: string; helper?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="mb-1 block text-sm font-medium">{label}</label>
      {helper && <p className="mb-1 text-xs text-muted-foreground">{helper}</p>}
      {children}
    </div>
  );
}
