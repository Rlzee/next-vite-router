import React from "react";

const styles: Record<string, React.CSSProperties> = {
  section: {
    width: "100%",
    padding: "64px 0",
  },
  container: {
    maxWidth: "672px",
    padding: "0 24px",
    margin: "0 auto",
  },
  content: {
    display: "flex",
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: "24px",
    textAlign: "left",
  },
  code: {
    fontSize: "30px",
    fontWeight: 600,
    letterSpacing: "-0.025em",
    margin: 0,
  },
  separator: {
    width: "1px",
    height: "48px",
    backgroundColor: "currentColor",
    opacity: 0.2,
  },
  textContainer: {
    display: "flex",
    flexDirection: "column",
  },
  heading: {
    fontSize: "18px",
    fontWeight: 500,
    margin: 0,
  },
  description: {
    fontSize: "14px",
    color: "#71717a",
    marginTop: "4px",
    marginBottom: 0,
  },
};

export function DefaultNotFound(): React.ReactNode {
  return React.createElement(
    "section",
    { style: styles.section },
    React.createElement(
      "div",
      { style: styles.container },
      React.createElement(
        "div",
        { style: styles.content },
        React.createElement("p", { style: styles.code }, "404"),
        React.createElement("span", {
          "aria-hidden": "true",
          style: styles.separator,
        }),
        React.createElement(
          "div",
          { style: styles.textContainer },
          React.createElement(
            "h1",
            { style: styles.heading },
            "This page could not be found",
          ),
          React.createElement(
            "p",
            { style: styles.description },
            "The link is broken or the page has been removed.",
          ),
        ),
      ),
    ),
  );
}