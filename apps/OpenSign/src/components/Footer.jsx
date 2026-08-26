import React, { useEffect, useState } from "react";
import Package from "../../package.json";
import axios from "axios";
import { openInNewTab } from "../constant/Utils";
import { appInfo } from "../constant/appinfo";

const SOURCE_URL = "https://github.com/SebastienDolce/kodara-sign";

const Footer = () => {
  const appName = appInfo.appName;
  const [showButton, setShowButton] = useState(false);
  const [version, setVersion] = useState("");

  useEffect(() => {
    axios
      .get("/version.txt")
      .then((response) => {
        setVersion(response.data);
      })
      .catch((error) => {
        console.error("Error reading the file:", error);
      });
  }, []);

  const handleScroll = () => {
    setShowButton(window.pageYOffset >= 50);
  };

  const scrollToTop = () => {
    window.scrollTo(0, 0);
    setShowButton(false);
  };

  useEffect(() => {
    window.addEventListener("scroll", handleScroll);
    return () => window.removeEventListener("scroll", handleScroll);
  }, []);

  const openUrl = () => {
    openInNewTab(SOURCE_URL);
  };

  return (
    <>
      <footer className="op-footer op-footer-center py-3 bg-base-300 text-base-content text-center text-[13px]">
        <aside>
          <p>
            {appName} · v{version || Package.version} · modified from OpenSign · AGPL-3.0 ·{" "}
            <span onClick={openUrl} className="hover:underline cursor-pointer font-medium">
              Source code
            </span>
          </p>
        </aside>
      </footer>
      <button
        className={`${
          showButton ? "block" : "hidden"
        } fixed bottom-4 right-4 px-3 p-2 text-xl op-bg-secondary text-white rounded focus:outline-none`}
        onClick={scrollToTop}
      >
        <i className="fa-light fa-angle-up"></i>
      </button>
    </>
  );
};

export default Footer;
