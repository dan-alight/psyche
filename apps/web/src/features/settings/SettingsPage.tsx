import { useMemo } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";

import { Button, Panel } from "@/components/ui";
import { listCredentials, listProviders, startOpenAiOAuth } from "@/lib/api";
import styles from "@/features/settings/SettingsPage.module.css";

export function SettingsPage() {
  const queryClient = useQueryClient();
  const providersQuery = useQuery({
    queryKey: ["providers"],
    queryFn: listProviders
  });
  const credentialsQuery = useQuery({
    queryKey: ["credentials"],
    queryFn: listCredentials
  });
  const oauthReturn = useMemo(() => {
    const params = new URLSearchParams(window.location.search);
    const providerKey = params.get("oauth");
    const status = params.get("status");
    const message = params.get("message");

    return providerKey === "openai" && (status === "connected" || status === "error")
      ? { status, message }
      : undefined;
  }, []);
  const startMutation = useMutation({
    mutationFn: startOpenAiOAuth,
    async onSuccess(result) {
      await queryClient.invalidateQueries({ queryKey: ["credentials"] });
      window.location.assign(result.authorizeUrl);
    }
  });

  const openAiProvider = providersQuery.data?.find((provider) => provider.key === "openai");
  const openAiCredentials = credentialsQuery.data?.filter((credential) => credential.providerId === openAiProvider?.id) ?? [];
  const activeCredential = openAiCredentials.find((credential) => credential.active);
  const latestCredential = activeCredential ?? openAiCredentials[0];
  const isLoading = providersQuery.isLoading || credentialsQuery.isLoading;
  const queryError = providersQuery.error ?? credentialsQuery.error;
  const status = queryError
    ? "Unavailable"
    : isLoading
      ? "Checking"
      : activeCredential
        ? "Connected"
        : latestCredential
          ? "Authorized"
          : "Not connected";

  return (
    <section className={styles.page}>
      <header className={styles.header}>
        <p className={styles.eyebrow}>Account</p>
        <h1>Settings</h1>
      </header>

      <Panel className={styles.oauthPanel} aria-label="ChatGPT subscription">
        <div className={styles.accountSummary}>
          <div>
            <p className={styles.label}>ChatGPT</p>
            <p className={styles.title}>OpenAI OAuth</p>
          </div>

          <span className={activeCredential ? styles.connectedBadge : styles.pendingBadge}>{status}</span>
        </div>

        {latestCredential ? (
          <dl className={styles.credentialDetails}>
            <div>
              <dt>Credential</dt>
              <dd>{latestCredential.label}</dd>
            </div>
            <div>
              <dt>Expires</dt>
              <dd>{latestCredential.expiresAt ? latestCredential.expiresAt.toLocaleString() : "No expiry"}</dd>
            </div>
          </dl>
        ) : null}

        <div className={styles.actions}>
          <Button
            disabled={startMutation.isPending}
            type="button"
            onClick={() => startMutation.mutate()}
          >
            Subscribe with ChatGPT
          </Button>
        </div>
      </Panel>

      {oauthReturn?.status === "connected" ? <p className={styles.success}>ChatGPT subscription connected.</p> : null}
      {oauthReturn?.status === "error" ? (
        <p className={styles.error}>{oauthReturn.message ?? "ChatGPT subscription was not connected."}</p>
      ) : null}
      {queryError ? <p className={styles.error}>{queryError.message}</p> : null}
      {startMutation.error ? <p className={styles.error}>{startMutation.error.message}</p> : null}
    </section>
  );
}
