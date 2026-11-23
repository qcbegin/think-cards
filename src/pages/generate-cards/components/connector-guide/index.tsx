import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy } from "lucide-react";
import { Separator, Text } from "@stellar-ui-kit/web";

// The endpoint is public; the token is never shown here (it lives in the
// Supabase secret MCP_TOKEN and in the connector's request header).
const CONNECTOR_URL = `${String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "")}/functions/v1/add-cards/mcp`;

const CARD_EXAMPLE = `{
  "front": "确认时间:到时见",
  "back": "<strong>See you then!</strong><br><em>casual</em>"
}`;

const CodeBlock = ({ children }: { children: string }) => (
  <pre className="overflow-x-auto rounded-md bg-surface p-3 text-xs text-foreground ring-1 ring-border whitespace-pre-wrap break-all">
    {children}
  </pre>
);

const Step = ({
  title,
  children,
}: {
  title: string;
  children: React.ReactNode;
}) => (
  <section className="flex flex-col gap-3">
    <div>
      <Text as="h2" className="text-lg font-semibold text-foreground">
        {title}
      </Text>
    </div>
    <Separator />
    {children}
  </section>
);

export const ConnectorGuide = () => {
  const { t } = useTranslation();
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    try {
      await navigator.clipboard.writeText(CONNECTOR_URL);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (error) {
      console.error(error);
    }
  };

  return (
    <div className="flex flex-col gap-10">
      <Text as="p" className="text-sm text-muted">
        {t("connectorIntro")}
      </Text>

      <Step title={t("connectorStep1Title")}>
        <Text as="p" className="text-sm text-muted">
          {t("connectorStep1Desc")}
        </Text>

        <ul className="flex flex-col gap-2 text-sm text-foreground">
          <li>
            <strong>{t("connectorFieldName")}</strong>: ThinkCards
          </li>
          <li>
            <strong>{t("connectorFieldUrl")}</strong>:
          </li>
        </ul>

        <div className="relative">
          <CodeBlock>{CONNECTOR_URL}</CodeBlock>
          <button
            type="button"
            onClick={handleCopy}
            className="absolute right-2 top-2 inline-flex items-center gap-1 rounded-md bg-background px-2 py-1 text-xs text-foreground ring-1 ring-border hover:bg-border"
          >
            {copied ? (
              <>
                <Check className="size-3" />
                {t("generateCardsCopied")}
              </>
            ) : (
              <>
                <Copy className="size-3" />
                {t("connectorCopyUrl")}
              </>
            )}
          </button>
        </div>

        <ul className="flex flex-col gap-2 text-sm text-foreground">
          <li>
            <strong>{t("connectorFieldAuth")}</strong>:{" "}
            {t("connectorFieldAuthValue")}
          </li>
          <li>
            <strong>{t("connectorFieldHeader")}</strong>:{" "}
            <code className="rounded bg-surface px-1 text-xs">
              Authorization
            </code>{" "}
            = <code className="rounded bg-surface px-1 text-xs">Bearer …</code>
          </li>
        </ul>

        <Text as="p" className="text-xs text-muted">
          {t("connectorTokenNote")}
        </Text>
      </Step>

      <Step title={t("connectorStep2Title")}>
        <Text as="p" className="text-sm text-muted">
          {t("connectorStep2Desc")}
        </Text>
        <CodeBlock>{t("connectorStep2Example")}</CodeBlock>
        <Text as="p" className="text-sm text-muted">
          {t("connectorStep2Result")}
        </Text>
      </Step>

      <Step title={t("connectorStep3Title")}>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-foreground">
          <li>{t("connectorRuleFront")}</li>
          <li>{t("connectorRuleBack")}</li>
          <li>{t("connectorRuleDeck")}</li>
          <li>{t("connectorRuleDuplicate")}</li>
          <li>{t("connectorRuleLimit")}</li>
        </ul>
        <CodeBlock>{CARD_EXAMPLE}</CodeBlock>
      </Step>

      <Step title={t("connectorStep4Title")}>
        <Text as="p" className="text-sm text-muted">
          {t("connectorStep4Desc")}
        </Text>
      </Step>

      <Step title={t("connectorTroubleTitle")}>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-foreground">
          <li>{t("connectorTroubleUnavailable")}</li>
          <li>{t("connectorTroubleNotShown")}</li>
          <li>{t("connectorTroubleLeak")}</li>
        </ul>
      </Step>
    </div>
  );
};
