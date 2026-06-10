/// <reference types="vitest/globals" />
import { buildTokens, renderMessage, type RenderContext } from "./render";

const base: RenderContext = {
  firstName: "Aisha",
  lastName: "Khan",
  email: "aisha.khan@example.com",
  phone: "+919800000001",
  attributes: { city: "Mumbai", tier: "gold", tags: ["loyalty"] },
};

describe("renderMessage", () => {
  it("resolves the documented token set", () => {
    expect(renderMessage("Hi {{first_name}} {{last_name}}!", base)).toBe("Hi Aisha Khan!");
    expect(renderMessage("Reach us at {{email}} / {{phone}}", base)).toBe(
      "Reach us at aisha.khan@example.com / +919800000001",
    );
    expect(renderMessage("{{tier}} member in {{city}}", base)).toBe("gold member in Mumbai");
  });

  it("tolerates surrounding whitespace inside the braces", () => {
    expect(renderMessage("Hi {{  first_name  }}", base)).toBe("Hi Aisha");
  });

  it("renders a known-but-missing token (e.g. absent attribute) as empty string", () => {
    const noCity: RenderContext = { ...base, attributes: { tier: "silver" } };
    expect(renderMessage("City: [{{city}}]", noCity)).toBe("City: []");

    const noPhone: RenderContext = { ...base, phone: null };
    expect(renderMessage("Phone: [{{phone}}]", noPhone)).toBe("Phone: []");
  });

  it("leaves an unknown token AS-IS (literal preserved)", () => {
    expect(renderMessage("Hello {{first_name}}, code {{promo_code}}", base)).toBe(
      "Hello Aisha, code {{promo_code}}",
    );
  });

  it("substitutes every occurrence of a repeated token", () => {
    expect(renderMessage("{{first_name}} {{first_name}}", base)).toBe("Aisha Aisha");
  });

  it("returns the template unchanged when there are no tokens", () => {
    expect(renderMessage("Flat 40% off this weekend only.", base)).toBe(
      "Flat 40% off this weekend only.",
    );
  });

  it("handles non-object / array attributes without crashing", () => {
    const weird: RenderContext = { ...base, attributes: null };
    expect(renderMessage("{{city}}|{{tier}}|{{first_name}}", weird)).toBe("||Aisha");

    const arr: RenderContext = { ...base, attributes: ["not", "an", "object"] };
    expect(renderMessage("{{city}}-{{first_name}}", arr)).toBe("-Aisha");
  });

  it("buildTokens exposes the documented keys", () => {
    expect(Object.keys(buildTokens(base)).sort()).toEqual([
      "city",
      "email",
      "first_name",
      "last_name",
      "phone",
      "tier",
    ]);
  });
});
