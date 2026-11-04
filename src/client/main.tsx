import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { DisplayApp } from "./DisplayApp";
import { isDisplayView } from "./entry";
import "./styles.css";

createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    {isDisplayView(window.location.search) ? <DisplayApp /> : <App />}
  </React.StrictMode>,
);
