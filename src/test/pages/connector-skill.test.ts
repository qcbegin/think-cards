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
