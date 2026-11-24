import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Check, Copy, Download } from "lucide-react";
import { Button, Separator, Text } from "@stellar-ui-kit/web";
import { BUNDLE_FILE, downloadBundle } from "./bundle";
import { downloadSkillZip, SKILL_NAME } from "./skill";

// The endpoint is public; the token is never shown here (it lives in the
// Supabase secret MCP_TOKEN and in the connector's request header).
const CONNECTOR_URL = `${String(import.meta.env.VITE_SUPABASE_URL ?? "").replace(/\/$/, "")}/functions/v1/add-cards/mcp`;

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
    <div className="flex flex-col gap-8">
      <Text as="p" className="text-sm text-muted">
        {t("connectorIntro")}
      </Text>

      <Step title={t("connectorStep1Title")}>
        <Text as="p" className="text-sm text-muted">
          {t("connectorBundleDesc")}
        </Text>

        <Button
          type="button"
          className="w-full sm:w-auto sm:self-start"
          onClick={() => downloadBundle(CONNECTOR_URL).catch(console.error)}
        >
          <Download className="size-4" />
          {t("connectorDownload", { file: BUNDLE_FILE })}
        </Button>

        <Text as="p" className="text-sm text-muted">
          {t("connectorBundleInstall")}
        </Text>

        <Text as="p" className="pt-2 text-sm font-medium text-foreground">
          {t("connectorManualTitle")}
        </Text>
        <Text as="p" className="text-sm text-muted">
          {t("connectorStep1Desc")}
        </Text>

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

        <Text as="p" className="text-sm text-muted">
          {t("connectorStep1Header")}{" "}
          <code className="rounded bg-surface px-1 text-xs">Authorization</code>{" "}
          = <code className="rounded bg-surface px-1 text-xs">Bearer …</code>
          {t("connectorStep1Token")}
        </Text>
      </Step>

      <Step title={t("connectorSkillTitle")}>
        <Text as="p" className="text-sm text-muted">
          {t("connectorSkillDesc")}
        </Text>

        <Button
          type="button"
          variant="outline"
          className="w-full sm:w-auto sm:self-start"
          onClick={() => downloadSkillZip(CONNECTOR_URL)}
        >
          <Download className="size-4" />
          {t("connectorDownload", { file: `${SKILL_NAME}.zip` })}
        </Button>
      </Step>

      <Step title={t("connectorUseTitle")}>
        <Text as="p" className="text-sm text-muted">
          {t("connectorUseDesc")}
        </Text>
        <CodeBlock>{t("connectorUseExamples")}</CodeBlock>
        <ul className="flex list-disc flex-col gap-2 pl-5 text-sm text-muted">
          <li>{t("connectorTipFormat")}</li>
          <li>{t("connectorTipSync")}</li>
        </ul>
      </Step>
    </div>
  );
};
