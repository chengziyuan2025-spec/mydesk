import React, { Profiler } from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import "./styles.css";

const app = <React.StrictMode><App /></React.StrictMode>;
ReactDOM.createRoot(document.getElementById("root")!).render(
  import.meta.env.DEV ? <Profiler id="DeskBox" onRender={(id, phase, actualDuration) => console.debug(`[deskbox:react] ${id} ${phase} ${actualDuration.toFixed(1)}ms`)}>{app}</Profiler> : app,
);
