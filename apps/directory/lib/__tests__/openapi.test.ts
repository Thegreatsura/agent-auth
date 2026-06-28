import { describe, expect, it } from "vitest";
import { deriveProviderFromSpec, slugify, toSnakeCase } from "../openapi";

type SpecArg = Parameters<typeof deriveProviderFromSpec>[0];

const mailSpec = {
  openapi: "3.0.3",
  info: { title: "Demo Mail API", description: "A tiny email API", version: "1.0.0" },
  servers: [{ url: "https://api.demo-mail.com/v1" }],
  paths: {
    "/messages": {
      get: {
        operationId: "messages.list",
        description: "List messages",
        parameters: [{ name: "q", in: "query", schema: { type: "string" } }],
        responses: {},
      },
      post: {
        operationId: "messages.send",
        description: "Send a message",
        requestBody: {
          required: true,
          content: {
            "application/json": {
              schema: { type: "object", required: ["to", "subject"], properties: { to: { type: "string" } } },
            },
          },
        },
        responses: {},
      },
    },
  },
} as unknown as SpecArg;

describe("deriveProviderFromSpec", () => {
  it("derives a slugged name, snake_case capabilities, and graduated approvals", () => {
    const d = deriveProviderFromSpec(mailSpec, "https://api.demo-mail.com/openapi.json");
    expect(d).not.toBeNull();
    expect(d!.name).toBe("demo-mail-api");
    expect(d!.displayName).toBe("Demo Mail API");
    expect(d!.baseUrl).toBe("https://api.demo-mail.com/v1");

    expect(d!.capabilities.map((c) => c.name).sort()).toEqual(["messages_list", "messages_send"]);

    const send = d!.capabilities.find((c) => c.name === "messages_send")!;
    expect(send.approvalStrength).toBe("webauthn");
    expect((send.input as { required?: string[] }).required).toContain("to");
    expect(send.method).toBe("POST");
    expect(send.path).toBe("/messages");

    const list = d!.capabilities.find((c) => c.name === "messages_list")!;
    expect(list.approvalStrength).toBe("session");
    expect(list.method).toBe("GET");
    expect(list.path).toBe("/messages");
  });

  it("returns null when the spec has no operations", () => {
    const empty = { openapi: "3.0.3", info: { title: "X" }, paths: {} } as unknown as SpecArg;
    expect(deriveProviderFromSpec(empty, "https://x.com/openapi.json")).toBeNull();
  });
});

describe("toSnakeCase", () => {
  it("normalizes operationIds to the protocol's [a-z0-9_]+ rule", () => {
    expect(toSnakeCase("findPetsByStatus")).toBe("find_pets_by_status");
    expect(toSnakeCase("getPetById")).toBe("get_pet_by_id");
    expect(toSnakeCase("messages.list")).toBe("messages_list");
    expect(toSnakeCase("create-thing")).toBe("create_thing");
    expect(toSnakeCase("uploadFile")).toBe("upload_file");
  });
});

describe("slugify", () => {
  it("produces URL-safe provider names", () => {
    expect(slugify("Swagger Petstore - OpenAPI 3.0")).toBe("swagger-petstore-openapi-3-0");
    expect(slugify("  Weird__Name!! ")).toBe("weird-name");
  });
});
