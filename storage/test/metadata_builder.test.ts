import { describe, it, expect } from "vitest";
import { buildTabletMetadata } from "../src/metadata_builder.js";

describe("buildTabletMetadata", () => {
  it("builds minimal metadata with only required fields", () => {
    const meta = buildTabletMetadata({
      deceased: { name: "王大明" },
      image: "ipfs://bafyPortrait",
    });

    expect(meta.name).toBe("王大明");
    expect(meta.image).toBe("ipfs://bafyPortrait");
    expect(meta.dsas.version).toBe("1.0");
    expect(meta.dsas.deceased.name).toBe("王大明");

    // Default attributes: 姓名 + 世代 (=0)
    const traits = meta.attributes.map((a) => a.trait_type);
    expect(traits).toContain("姓名");
    expect(traits).toContain("世代");

    const gen = meta.attributes.find((a) => a.trait_type === "世代");
    expect(gen?.value).toBe(0);
  });

  it("derives full attribute set with descendants and assets", () => {
    const meta = buildTabletMetadata({
      deceased: {
        name: "王大明",
        gender: "male",
        origin: "台灣彰化縣鹿港鎮",
        birth: { date: "1940-02-15", place: "彰化鹿港" },
        death: { date: "2024-01-01", place: "台北" },
        biography: "教師四十年。",
        epitaph: "一生清淨",
      },
      generation: 0,
      image: "ipfs://bafyPortrait",
      external_url: "https://dsas.app/tablet/42",
      descendants: [
        { name: "王小華", relation: "長子", tokenId: 47 },
        { name: "王小美", relation: "次女", tokenId: 48 },
      ],
      assets: {
        portrait: "ipfs://bafyPortrait",
        photos: ["ipfs://bafyPhoto1", "ipfs://bafyPhoto2"],
        chatlogs: [
          { platform: "line", uri: "ipfs://bafyLine", format: "json" },
        ],
      },
      consent: {
        declaredBy: "0x1111111111111111111111111111111111111111",
        statement: "本人聲明持有逝者之肖像、聲音、文字使用同意。",
        signedAt: "2026-05-05T12:00:00Z",
      },
    });

    const traits = meta.attributes.map((a) => a.trait_type);
    expect(traits).toEqual(
      expect.arrayContaining([
        "姓名",
        "性別",
        "籍貫",
        "出生日期",
        "逝世日期",
        "享壽",
        "世代",
      ]),
    );

    const birth = meta.attributes.find((a) => a.trait_type === "出生日期");
    expect(birth?.display_type).toBe("date");
    expect(birth?.value).toBe(Math.floor(Date.parse("1940-02-15") / 1000));

    const death = meta.attributes.find((a) => a.trait_type === "逝世日期");
    expect(death?.value).toBe(Math.floor(Date.parse("2024-01-01") / 1000));

    const age = meta.attributes.find((a) => a.trait_type === "享壽");
    expect(age?.value).toBe(83); // 1940-02-15 → 2024-01-01 hasn't reached birthday

    expect(meta.dsas.descendants?.length).toBe(2);
    expect(meta.dsas.assets?.photos?.length).toBe(2);
    expect(meta.dsas.consent?.declaredBy).toMatch(/^0x/);
    expect(meta.external_url).toBe("https://dsas.app/tablet/42");
  });

  it("auto-falls back to assets.portrait when image missing", () => {
    const meta = buildTabletMetadata({
      deceased: { name: "王大明" },
      assets: { portrait: "ipfs://bafyOnlyInAssets" },
    });
    expect(meta.image).toBe("ipfs://bafyOnlyInAssets");
  });

  it("throws on missing deceased.name", () => {
    expect(() =>
      buildTabletMetadata({
        deceased: { name: "" },
        image: "ipfs://bafy",
      }),
    ).toThrow(/deceased\.name/);
  });

  it("throws on missing image and missing assets.portrait", () => {
    expect(() =>
      buildTabletMetadata({
        deceased: { name: "王大明" },
      }),
    ).toThrow(/image/);
  });

  it("throws on invalid date string", () => {
    expect(() =>
      buildTabletMetadata({
        deceased: {
          name: "王大明",
          birth: { date: "not-a-date" },
        },
        image: "ipfs://bafy",
      }),
    ).toThrow(/invalid date/);
  });
});
