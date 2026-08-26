import { TEditorConfiguration } from "../../documents/editor/core";

const getRequestEmail = (): TEditorConfiguration => {
  const appName = "Kodara Sign";

  const logoBlock = {
    "block-1709571212684": {
      type: "Html",
      data: {
        style: {
          backgroundColor: "#0A0A0A",
          padding: { top: 28, bottom: 24, right: 28, left: 28 }
        },
        props: {
          contents:
            '<div style="font-family:Arial,Helvetica,sans-serif;font-size:25px;font-weight:900;letter-spacing:-1px;color:#fff;">KODARA<span style="color:#EF2B2D">.</span><span style="float:right;font-size:11px;letter-spacing:3px;color:#A6A6A6;">SIGN</span></div>'
        }
      }
    }
  };
  const logoBlockId = ["block-1709571212684"];

  return {
    root: {
      type: "EmailLayout",
      data: {
        backdropColor: "#111111",
        canvasColor: "#0A0A0A",
        canvasWidth: 600,
        textColor: "#EDEDED",
        fontFamily: "MODERN_SANS",
        childrenIds: [
          ...logoBlockId,
          "block-1770633502472",
          "block-1770633643816",
          "block-1770633750385",
          "block-1770633994542",
          "block-1770795931867"
        ]
      }
    },
    ...logoBlock,
    "block-1770633502472": {
      type: "Text",
      data: {
        style: {
          color: "#EF2B2D",
          backgroundColor: "#0A0A0A",
          fontSize: 12,
          fontWeight: "bold",
          padding: {
            top: 16,
            bottom: 16,
            right: 24,
            left: 24
          }
        },
        props: {
          markdown: false,
          text: "ACTION REQUIRED / DIGITAL SIGNATURE REQUEST"
        }
      }
    },
    "block-1770633643816": {
      type: "Html",
      data: {
        style: {
          color: "#C6C6C6",
          fontSize: 14,
          textAlign: null,
          padding: {
            top: 20,
            bottom: 20,
            right: 20,
            left: 20
          }
        },
        props: {
          contents:
            "{{sender_name}} has requested you to review and sign <b>{{document_title}}</b>."
        }
      }
    },
    "block-1770633750385": {
      type: "ColumnsContainer",
      data: {
        style: {
          padding: {
            top: 20,
            bottom: 32,
            right: 20,
            left: 4
          }
        },
        props: {
          fixedWidths: [128, null, null],
          columnsCount: 2,
          columnsGap: 0,
          contentAlignment: "top",
          columns: [
            {
              childrenIds: [
                "block-1770633797211",
                "block-1770633912944",
                "block-1770633918679",
                "block-1770633961786"
              ]
            },
            {
              childrenIds: [
                "block-1770633813576",
                "block-1770633915601",
                "block-1770633921948",
                "block-1770633964531"
              ]
            },
            {
              childrenIds: []
            }
          ]
        }
      }
    },
    "block-1770633797211": {
      type: "Text",
      data: {
        style: {
          fontSize: 15,
          fontWeight: "bold",
          padding: {
            top: 0,
            bottom: 0,
            right: 24,
            left: 24
          }
        },
        props: {
          text: "Sender"
        }
      }
    },
    "block-1770633813576": {
      type: "Text",
      data: {
        style: {
          color: "#EDEDED",
          fontSize: 15,
          fontWeight: "bold",
          padding: {
            top: 0,
            bottom: 0,
            right: 24,
            left: 0
          }
        },
        props: {
          text: "{{sender_mail}}"
        }
      }
    },
    "block-1770633912944": {
      type: "Text",
      data: {
        style: {
          fontSize: 15,
          fontWeight: "bold",
          padding: {
            top: 0,
            bottom: 0,
            right: 24,
            left: 24
          }
        },
        props: {
          text: "Organization"
        }
      }
    },
    "block-1770633915601": {
      type: "Text",
      data: {
        style: {
          color: "#EDEDED",
          fontSize: 15,
          fontWeight: "bold",
          padding: {
            top: 0,
            bottom: 0,
            right: 24,
            left: 0
          }
        },
        props: {
          text: "{{company_name}}"
        }
      }
    },
    "block-1770633918679": {
      type: "Text",
      data: {
        style: {
          fontSize: 15,
          fontWeight: "bold",
          padding: {
            top: 0,
            bottom: 0,
            right: 24,
            left: 24
          }
        },
        props: {
          text: "Expires on"
        }
      }
    },
    "block-1770633921948": {
      type: "Text",
      data: {
        style: {
          color: "#EDEDED",
          backgroundColor: null,
          fontSize: 15,
          fontWeight: "bold",
          padding: {
            top: 0,
            bottom: 0,
            right: 24,
            left: 0
          }
        },
        props: {
          text: "{{expiry_date}}"
        }
      }
    },
    "block-1770633961786": {
      type: "Text",
      data: {
        style: {
          fontSize: 15,
          fontWeight: "bold",
          padding: {
            top: 0,
            bottom: 0,
            right: 24,
            left: 24
          }
        },
        props: {
          text: "Note"
        }
      }
    },
    "block-1770633964531": {
      type: "Text",
      data: {
        style: {
          color: "#EDEDED",
          fontSize: 15,
          fontWeight: "bold",
          padding: {
            top: 0,
            bottom: 0,
            right: 24,
            left: 0
          }
        },
        props: {
          text: "{{note}}"
        }
      }
    },
    "block-1770633994542": {
      type: "Button",
      data: {
        style: {
          fontSize: 14,
          textAlign: "left",
          padding: {
            top: 12,
            bottom: 20,
            right: 12,
            left: 52
          }
        },
        props: {
          buttonBackgroundColor: "#EF2B2D",
          buttonStyle: "rectangle",
          fullWidth: false,
          size: "medium",
          text: "REVIEW & SIGN",
          url: "{{signing_url}}"
        }
      }
    },
    "block-1770795931867": {
      type: "Html",
      data: {
        style: {
          color: "#A6A6A6",
          backgroundColor: "#080808",
          fontSize: 14,
          textAlign: null,
          padding: {
            top: 16,
            bottom: 16,
            right: 24,
            left: 24
          }
        },
        props: {
          contents: `Sent securely with <b>${appName}</b>. Questions about this document should be directed to <a href="mailto:{{sender_mail}}" target="_blank" style="color:#ededed">{{sender_mail}}</a>.`
        }
      }
    }
  };
};
export default getRequestEmail;
