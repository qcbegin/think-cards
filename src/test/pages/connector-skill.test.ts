import { describe, expect, it } from "vitest";
import { strFromU8, unzipSync } from "fflate";
import {
  buildSkillZip,
  SKILL_NAME,
} from "@/pages/generate-cards/components/connector-guide/skill";
import { TOOLS } from "../../../supabase/functions/add-cards/mcp";

describe("connector skill zip", () => {
  const url = "https://example.supabase.co/functions/v1/add-cards/mcp";
  const files = unzipSync(buildSkillZip(url));
  const md = strFromU8(files[`${SKILL_NAME}/SKILL.md`]);

  it("holds one SKILL.md inside a folder named after the skill", () => {
    expect(Object.keys(files)).toEqual([`${SKILL_NAME}/`, `${SKILL_NAME}/SKILL.md`]);
    expect(md).toMatch(new RegExp(`^---\\nname: "${SKILL_NAME}"\\ndescription: ".+"\\n---\\n`));
  });

  it("names every connector tool and the endpoint, never a token", () => {
    for (const tool of TOOLS) expect(md, tool.name).toContain(tool.name);
    expect(md).toContain(url);
    expect(md).not.toMatch(/Bearer [A-Za-z0-9]{8,}/);
  });
});

describe("connector bundle (.mcpb)", () => {
  const url = "https://example.supabase.co/functions/v1/add-cards/mcp";

  it("packs manifest, proxy and optional icon with the endpoint as default URL", async () => {
    const { buildBundle } = await import("@/pages/generate-cards/components/connector-guide/bundle");
    const files = unzipSync(buildBundle(url, new Uint8Array([1, 2, 3])));
    expect(Object.keys(files).sort()).toEqual(["icon.png", "manifest.json", "server/", "server/index.js"]);

    const manifest = JSON.parse(strFromU8(files["manifest.json"]));
    expect(manifest.server.entry_point).toBe("server/index.js");
    expect(manifest.user_config.server_url.default).toBe(url);
    expect(manifest.user_config.token.sensitive).toBe(true);
    expect(manifest.icon).toBe("icon.png");
    expect(manifest.tools.map((t: { name: string }) => t.name)).toEqual(TOOLS.map((t) => t.name));
    expect(strFromU8(files["server/index.js"])).toContain("THINKCARDS_TOKEN");

    const plain = unzipSync(buildBundle(url));
    expect(JSON.parse(strFromU8(plain["manifest.json"])).icon).toBeUndefined();
  });
});
