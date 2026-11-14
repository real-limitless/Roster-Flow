import { FormEvent, useState } from "react";
import { Navigate } from "react-router-dom";
import { Logo } from "../components/Logo";
import { Alert, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Field, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import { api, setAuthToken } from "../lib/api";
import { useAuth } from "../lib/auth";

export function LoginForm({
  emailDefault = "",
  onSignedIn,
  testId = "login-form",
}: {
  emailDefault?: string;
  onSignedIn?: () => void;
  testId?: string;
}) {
  const { login } = useAuth();
  const [email, setEmail] = useState(emailDefault);
  const [password, setPassword] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);
  const invalid = err ? true : undefined;

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setErr("");
    setBusy(true);
    try {
      await login(email, password);
      onSignedIn?.();
    } catch (error) {
      setErr(error instanceof Error ? error.message : "sign in failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form data-testid={testId} onSubmit={onSubmit}>
      <FieldGroup>
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={`${testId}-email`}>Email</FieldLabel>
          <Input
            id={`${testId}-email`}
            data-testid="setup-login-email"
            type="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            autoComplete="username"
            aria-invalid={invalid}
            required
          />
        </Field>
        <Field data-invalid={invalid}>
          <FieldLabel htmlFor={`${testId}-password`}>Password</FieldLabel>
          <Input
            id={`${testId}-password`}
            data-testid="setup-login-password"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            autoComplete="current-password"
            aria-invalid={invalid}
            required
          />
        </Field>
        {err ? <FieldError>{err}</FieldError> : null}
        <Button className="w-full" data-testid="setup-login-submit" type="submit" disabled={busy}>
          {busy ? <Spinner data-icon="inline-start" /> : null}
          {busy ? "Signing in…" : "Sign in"}
        </Button>
      </FieldGroup>
    </form>
  );
}

export function Login() {
  const { status, loading, refresh } = useAuth();
  const [wipeOpen, setWipeOpen] = useState(false);
  const [emailConfirm, setEmailConfirm] = useState("");
  const [passwordConfirm, setPasswordConfirm] = useState("");
  const [bootstrapToken, setBootstrapToken] = useState("");
  const [wipeErr, setWipeErr] = useState("");
  const [wipeBusy, setWipeBusy] = useState(false);
  const wipeInvalid = wipeErr ? true : undefined;
  if (loading) return <div className="setup-shell">Loading…</div>;
  if (status?.skip || (status?.complete && status.authenticated)) return <Navigate to="/app" replace />;
  if (status && !status.complete) return <Navigate to="/setup" replace />;

  async function startOver() {
    setWipeErr("");
    setWipeBusy(true);
    try {
      await api.setupStartOver({
        email: emailConfirm,
        confirm: true,
        password: passwordConfirm,
        ...(bootstrapToken ? { bootstrapToken } : {}),
      });
      setAuthToken("");
      await refresh();
    } catch (error) {
      setWipeErr(error instanceof Error ? error.message : "could not start over");
    } finally {
      setWipeBusy(false);
    }
  }

  return (
    <div className="flex min-h-dvh items-start justify-center px-5 py-12" data-testid="login-page">
      <Card className="w-full max-w-md">
        <CardHeader>
          <Logo to="/" />
          <Badge variant="outline">Owner</Badge>
          <CardTitle>
            <h1>Sign in</h1>
          </CardTitle>
          <CardDescription>Local owner account. This is not SSO.</CardDescription>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <LoginForm />
          <p className="text-sm text-muted-foreground" data-testid="login-recover">
            Forgot the password? Stop CORE, then <code>npm run owner:reset</code>. That rewrites the hash and keeps seats
            and runs.
          </p>
          <Separator />
          {!wipeOpen ? (
            <Button variant="outline" type="button" data-testid="login-start-over" onClick={() => setWipeOpen(true)}>
              Wipe this company and run setup again
            </Button>
          ) : (
            <Card size="sm" data-testid="start-over-form">
              <CardHeader>
                <CardTitle>
                  <h2>Start over</h2>
                </CardTitle>
                <CardDescription>
                  This deletes the local owner and org from this machine. Type the owner email and password to confirm.
                </CardDescription>
              </CardHeader>
              <CardContent>
                <FieldGroup>
                  <Field data-invalid={wipeInvalid}>
                    <FieldLabel htmlFor="start-over-email">Owner email</FieldLabel>
                    <Input
                      id="start-over-email"
                      data-testid="start-over-email"
                      type="email"
                      value={emailConfirm}
                      onChange={(e) => setEmailConfirm(e.target.value)}
                      autoComplete="username"
                      aria-invalid={wipeInvalid}
                      required
                    />
                  </Field>
                  <Field data-invalid={wipeInvalid}>
                    <FieldLabel htmlFor="start-over-password">Owner password</FieldLabel>
                    <Input
                      id="start-over-password"
                      data-testid="start-over-password"
                      type="password"
                      value={passwordConfirm}
                      onChange={(e) => setPasswordConfirm(e.target.value)}
                      autoComplete="current-password"
                      minLength={8}
                      aria-invalid={wipeInvalid}
                      required
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="start-over-bootstrap-token">Bootstrap token</FieldLabel>
                    <Input
                      id="start-over-bootstrap-token"
                      data-testid="start-over-bootstrap-token"
                      type="password"
                      value={bootstrapToken}
                      onChange={(e) => setBootstrapToken(e.target.value)}
                      autoComplete="off"
                      placeholder="Only if ROSTER_BOOTSTRAP_TOKEN is set"
                    />
                  </Field>
                  {wipeErr ? (
                    <Alert variant="destructive">
                      <AlertTitle>{wipeErr}</AlertTitle>
                    </Alert>
                  ) : null}
                  <Button
                    variant="destructive"
                    data-testid="start-over-confirm"
                    type="button"
                    disabled={wipeBusy}
                    onClick={() => void startOver()}
                  >
                    {wipeBusy ? <Spinner data-icon="inline-start" /> : null}
                    {wipeBusy ? "Wiping…" : "Confirm start over"}
                  </Button>
                </FieldGroup>
              </CardContent>
            </Card>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
