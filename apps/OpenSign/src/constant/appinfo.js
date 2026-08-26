import logo from "../assets/images/kodara-sign-logo.svg";
import darkLogo from "../assets/images/kodara-sign-logo-dark.svg";
import { getEnv } from "./Utils";

export function serverUrl_fn() {
  const env = getEnv();
  const serverurl = env?.REACT_APP_SERVERURL
    ? env.REACT_APP_SERVERURL // env.REACT_APP_SERVERURL is used for prod
    : process.env.REACT_APP_SERVERURL; // process.env.REACT_APP_SERVERURL is used for dev (locally)
  let baseUrl = serverurl ? serverurl : window.location.origin + "/api/app";
  return baseUrl;
}

export const appInfo = {
  appName: "Kodara Sign",
  applogo: logo,
  darkLogo,
  appId: process.env.REACT_APP_APPID ? process.env.REACT_APP_APPID : "opensign",
  baseUrl: serverUrl_fn(),
  defaultRole: "contracts_User",
  fev_Icon: "/kodara-sign-favicon.svg",
  docsUrl: "https://github.com/SebastienDolce/kodara-sign",
  googleClientId: process.env.REACT_APP_GOOGLECLIENTID
    ? `${process.env.REACT_APP_GOOGLECLIENTID}`
    : "",
  metaDescription:
    "Securely sign PDFs and request signatures with Kodara Sign.",
  settings: [
    {
      role: "contracts_Admin",
      menuId: "VPh91h0ZHk",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    },
    {
      role: "contracts_OrgAdmin",
      menuId: "VPh91h0ZHk",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    },
    {
      role: "contracts_Editor",
      menuId: "H9vRfEYKhT",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    },
    {
      role: "contracts_User",
      menuId: "H9vRfEYKhT",
      pageType: "dashboard",
      pageId: "35KBoSgoAK",
      extended_class: "contracts_Users"
    }
  ]
};
