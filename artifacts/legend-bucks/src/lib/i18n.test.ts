import assert from "node:assert/strict";
import { test } from "node:test";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import ts from "typescript";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { getGetMeQueryKey, type CurrentUser } from "@workspace/api-client-react";
import { I18nProvider, useI18n, translate } from "./i18n";
import { setFormattingLanguage } from "./locale";
import { formatCad } from "./store-card";
import { formatDate } from "./utils";
import common from "./locales/common";
import consumer from "./locales/consumer";
import admin from "./locales/admin";
import checkout from "./locales/checkout";
import errors from "./locales/errors";

const dictionary: Record<string, string> = { ...consumer, ...admin, ...checkout, ...common, ...errors };
const sourceRoot = fileURLToPath(new URL("../", import.meta.url));

test("settings uses FormLabel only inside registered FormField components", () => {
  const path = resolve(sourceRoot, "pages/settings.tsx");
  const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let formLabelCount = 0;
  const visit = (node: ts.Node) => {
    if (ts.isJsxElement(node) && node.openingElement.tagName.getText(ast) === "FormLabel") {
      formLabelCount++;
      let ancestor: ts.Node | undefined = node.parent;
      while (ancestor && !(ts.isJsxSelfClosingElement(ancestor) && ancestor.tagName.getText(ast) === "FormField")) {
        ancestor = ancestor.parent;
      }
      assert.ok(ancestor, "FormLabel must be rendered by a registered FormField");
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.equal(formLabelCount, 2);
});

test("settings profile reset does not depend on replacement user cache objects", () => {
  const path = resolve(sourceRoot, "pages/settings.tsx");
  const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  let resetDependencies: string[] | undefined;
  const visit = (node: ts.Node) => {
    if (ts.isCallExpression(node) && node.expression.getText(ast) === "form.reset") {
      let ancestor: ts.Node | undefined = node.parent;
      while (ancestor && !(ts.isCallExpression(ancestor) && ancestor.expression.getText(ast) === "useEffect")) {
        ancestor = ancestor.parent;
      }
      assert.ok(ancestor && ts.isCallExpression(ancestor));
      const dependencies = ancestor.arguments[1];
      assert.ok(dependencies && ts.isArrayLiteralExpression(dependencies));
      resetDependencies = dependencies.elements.map((element) => element.getText(ast));
    }
    ts.forEachChild(node, visit);
  };
  visit(ast);
  assert.deepEqual(resetDependencies, ["user?.id", "user?.firstName", "user?.lastName", "form"]);
});

test("every literal UI translation has a French dictionary entry", () => {
  const missing: string[] = [];
  const checkDirectory = (directory: string) => {
    for (const fileName of readdirSync(directory, { withFileTypes: true })) {
      const path = resolve(directory, fileName.name);
      if (fileName.isDirectory()) { checkDirectory(path); continue; }
      if (!fileName.name.endsWith(".tsx") || fileName.name.endsWith(".test.tsx")) continue;
      const ast = ts.createSourceFile(path, readFileSync(path, "utf8"), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
      const visit = (node: ts.Node) => {
        if (ts.isCallExpression(node) && ts.isIdentifier(node.expression) && node.expression.text === "t") {
          const key = node.arguments[0];
          if (key && ts.isStringLiteral(key) && !dictionary[key.text]) missing.push(`${fileName.name}: ${key.text}`);
        }
        if (ts.isJsxSelfClosingElement(node) && ts.isIdentifier(node.tagName) && node.tagName.text === "I18nText") {
          const attribute = node.attributes.properties.find((prop) => ts.isJsxAttribute(prop) && prop.name.getText(ast) === "text");
          if (attribute && ts.isJsxAttribute(attribute) && attribute.initializer && ts.isStringLiteral(attribute.initializer)
            && !dictionary[attribute.initializer.text]) missing.push(`${fileName.name}: ${attribute.initializer.text}`);
        }
        ts.forEachChild(node, visit);
      };
      visit(ast);
    }
  };
  checkDirectory(sourceRoot);
  assert.deepEqual(missing, []);
});

test("French translations preserve all interpolation fields", () => {
  const slots = (value: string) => [...value.matchAll(/\{(\w+)\}/g)].map((match) => match[1]).sort();
  for (const [source, french] of Object.entries(dictionary)) {
    assert.ok(french.trim(), source);
    assert.deepEqual(slots(french), slots(source), source);
  }
});

test("interpolation leaves authentic names and identifiers untouched", () => {
  assert.equal(translate("fr-CA", "We sent a code to {email}", { email: "pat@legendboats.com" }), "Nous avons envoyé un code à pat@legendboats.com.");
  assert.equal(translate("en", "We sent a code to {email}", { email: "pat@legendboats.com" }), "We sent a code to pat@legendboats.com");
  assert.equal(translate("fr-CA", "Uncatalogued product name"), "Uncatalogued product name");
  assert.equal(translate("fr-CA", "{count} rows", { count: 0 }), "0 lignes");
});

test("legacy date and CAD helpers respect the selected Canadian locale", () => {
  for (const language of ["en", "fr-CA"] as const) {
    setFormattingLanguage(language);
    const locale = language === "en" ? "en-CA" : "fr-CA";
    assert.equal(formatCad(1234567), new Intl.NumberFormat(locale, { style: "currency", currency: "CAD" }).format(12345.67));
    assert.equal(formatDate("2026-06-15T12:00:00Z"), new Date("2026-06-15T12:00:00Z").toLocaleDateString(locale, { year: "numeric", month: "short", day: "numeric" }));
  }
  setFormattingLanguage("en");
});

function probe(user?: CurrentUser) {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  if (user) queryClient.setQueryData(getGetMeQueryKey(), user);
  let result: ReturnType<typeof useI18n> | undefined;
  const Probe = () => { result = useI18n(); return null; };
  renderToStaticMarkup(React.createElement(QueryClientProvider, { client: queryClient },
    React.createElement(I18nProvider, null, React.createElement(Probe))));
  queryClient.clear();
  assert.ok(result);
  return result;
}

test("authenticated saved language is authoritative over browser preference", () => {
  const originalStorage = globalThis.localStorage;
  const storage = new Map([["legend_bucks_language", "en"]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null } });
  try {
    const user: CurrentUser = {
      id: 1, firstName: "Test", lastName: "Person", email: "test@example.test", role: "team_member", status: "active",
      preferredLanguage: "fr-CA", notifyBucksReceived: true, notifyRedemptionUpdates: true, notifyNewRedemptionRequests: true,
    };
    const value = probe(user);
    assert.equal(value.language, "fr-CA");
    assert.equal(value.pending, false);
    assert.equal(value.t("Settings"), "Paramètres");
    assert.equal(value.label("team_member"), "Membre de l’équipe");
    assert.equal(value.label("requested"), "Demandé");
    assert.equal(value.error({ data: { error: "Invalid card code" } }), "Code de carte invalide");
    assert.equal(value.error("Unexpected technical detail"), "Unexpected technical detail");
    assert.equal(value.number(12345.5), new Intl.NumberFormat("fr-CA").format(12345.5));
    assert.equal(value.currency(12.34), new Intl.NumberFormat("fr-CA", { style: "currency", currency: "CAD" }).format(12.34));
    assert.equal(value.date("2026-06-15T12:00:00Z", { dateStyle: "long" }), new Intl.DateTimeFormat("fr-CA", { dateStyle: "long" }).format(new Date("2026-06-15T12:00:00Z")));
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
  }
});

test("logged-out language and explicit login choice persist, without overriding accounts by default", () => {
  const originalStorage = globalThis.localStorage;
  const storage = new Map([["legend_bucks_language", "fr-CA"], ["legend_bucks_login_language_choice", "fr-CA"]]);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, value: { getItem: (key: string) => storage.get(key) ?? null } });
  try {
    const explicit = probe();
    assert.equal(explicit.language, "fr-CA");
    assert.deepEqual(explicit.loginPreference, { preferredLanguage: "fr-CA" });
    storage.delete("legend_bucks_login_language_choice");
    const remembered = probe();
    assert.equal(remembered.language, "fr-CA");
    assert.deepEqual(remembered.loginPreference, {});
    assert.equal(remembered.pending, false);
  } finally {
    Object.defineProperty(globalThis, "localStorage", { configurable: true, value: originalStorage });
  }
});