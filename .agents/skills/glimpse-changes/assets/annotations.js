// Annotations system — text selection → comment → sidebar
(function () {
  "use strict";

  const annotations = [];
  let nextId = 1;
  let draft = null; // { range, selectedText, context, anchorEl }

  const sidebar = document.getElementById("comments-sidebar");
  const trigger = document.querySelector(".comment-trigger");
  const doneButton = document.querySelector(".done-button");

  // ── Helpers ──

  function getBlockContext(node) {
    // Walk up to find the nearest annotatable block
    let el = node.nodeType === Node.TEXT_NODE ? node.parentElement : node;
    while (el && el.id !== "content") {
      // Markdown block elements
      if (el.dataset && el.dataset.blockIndex !== undefined) {
        return {
          type: "text",
          blockIndex: parseInt(el.dataset.blockIndex, 10),
          blockTag: el.tagName.toLowerCase(),
          blockText: el.textContent.slice(0, 200),
        };
      }
      // Diff line — look for data-line-number on a row
      const diffRow = el.closest("[data-line-number]");
      if (diffRow) {
        const diffShell = diffRow.closest("[data-diff-shell]");
        const pathLabel = diffShell?.querySelector(".diff-path-label");
        return {
          type: "diff",
          file: pathLabel?.textContent || "unknown",
          lineNumber: diffRow.getAttribute("data-line-number"),
          lineText: diffRow.textContent.slice(0, 200),
        };
      }
      // Diff host — any selection inside a diff block
      const diffHost = el.closest(".diffs-host");
      if (diffHost) {
        const diffShell = diffHost.closest("[data-diff-shell]");
        const pathLabel = diffShell?.querySelector(".diff-path-label");
        return {
          type: "diff",
          file: pathLabel?.textContent || "unknown",
          lineNumber: null,
          lineText: el.textContent.slice(0, 200),
        };
      }
      el = el.parentElement;
    }
    return { type: "text", blockIndex: null, blockTag: null, blockText: null };
  }

  function contextLabel(ctx) {
    if (ctx.type === "diff") {
      const line = ctx.lineNumber ? `:${ctx.lineNumber}` : "";
      return `${ctx.file}${line}`;
    }
    return ctx.blockTag || "text";
  }

  function updateBodyClasses() {
    document.body.classList.toggle("has-comments", annotations.length > 0);
    document.body.classList.toggle("is-drafting", draft !== null);
  }

  function updateDoneButton() {
    if (!doneButton) return;
    const label = doneButton.querySelector(".done-label");
    let badge = doneButton.querySelector(".done-badge");
    if (annotations.length > 0) {
      if (label) label.textContent = "Review";
      if (!badge) {
        badge = document.createElement("span");
        badge.className = "done-badge";
        doneButton.appendChild(badge);
      }
      badge.textContent = annotations.length;
    } else {
      if (label) label.textContent = "Done";
      if (badge) badge.remove();
    }
  }

  // ── Highlight management ──

  function applyHighlight(annotation) {
    // For text selections, wrap with <mark>
    if (annotation.range) {
      try {
        const mark = document.createElement("mark");
        mark.className = "annotation-highlight";
        mark.dataset.annotationId = annotation.id;
        annotation.range.surroundContents(mark);
        annotation.markEl = mark;
      } catch {
        // Range may span multiple elements — fall back to no visual highlight
        annotation.markEl = null;
      }
    }
  }

  function removeHighlight(annotation) {
    if (annotation.markEl) {
      const parent = annotation.markEl.parentNode;
      while (annotation.markEl.firstChild) {
        parent.insertBefore(annotation.markEl.firstChild, annotation.markEl);
      }
      parent.removeChild(annotation.markEl);
      parent.normalize();
      annotation.markEl = null;
    }
  }

  // ── Sidebar rendering ──

  function renderSidebar() {
    // Clear existing cards (keep draft if present)
    sidebar.querySelectorAll(".comment-card").forEach((c) => c.remove());

    for (const ann of annotations) {
      const card = document.createElement("div");
      card.className = "comment-card";
      card.dataset.annotationId = ann.id;

      const ctx = document.createElement("div");
      ctx.className = "comment-card-context";
      ctx.textContent = contextLabel(ann.context);
      if (ann.selectedText) {
        ctx.textContent += ` — "${ann.selectedText.slice(0, 50)}${ann.selectedText.length > 50 ? "…" : ""}"`;
      }
      card.appendChild(ctx);

      const text = document.createElement("div");
      text.className = "comment-card-text";
      text.textContent = ann.comment;
      card.appendChild(text);

      const del = document.createElement("button");
      del.className = "comment-card-delete";
      del.textContent = "×";
      del.title = "Delete comment";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        deleteAnnotation(ann.id);
      });
      card.appendChild(del);

      // Click card → scroll to highlight
      card.addEventListener("click", () => {
        if (ann.markEl) {
          ann.markEl.scrollIntoView({ behavior: "smooth", block: "center" });
          // Flash active state
          document
            .querySelectorAll(".comment-card.active, mark.active")
            .forEach((el) => el.classList.remove("active"));
          card.classList.add("active");
          ann.markEl.classList.add("active");
          setTimeout(() => {
            card.classList.remove("active");
            ann.markEl?.classList.remove("active");
          }, 2000);
        }
      });

      // Insert before draft if present, else append
      const draftEl = sidebar.querySelector(".comment-draft");
      if (draftEl) {
        sidebar.insertBefore(card, draftEl);
      } else {
        sidebar.appendChild(card);
      }
    }

    updateBodyClasses();
    updateDoneButton();
  }

  function deleteAnnotation(id) {
    const idx = annotations.findIndex((a) => a.id === id);
    if (idx === -1) return;
    removeHighlight(annotations[idx]);
    annotations.splice(idx, 1);
    renderSidebar();
  }

  // ── Draft management ──

  function openDraft(selectedText, range, context, anchorEl) {
    closeDraft();
    draft = { selectedText, range, context, anchorEl };
    updateBodyClasses();

    const draftEl = document.createElement("div");
    draftEl.className = "comment-draft";

    const ctx = document.createElement("div");
    ctx.className = "comment-draft-context";
    ctx.textContent = contextLabel(context);
    if (selectedText) {
      ctx.textContent += ` — "${selectedText.slice(0, 50)}${selectedText.length > 50 ? "…" : ""}"`;
    }
    draftEl.appendChild(ctx);

    const textarea = document.createElement("textarea");
    textarea.placeholder = "Add a comment…";
    draftEl.appendChild(textarea);

    const actions = document.createElement("div");
    actions.className = "comment-draft-actions";

    const cancelBtn = document.createElement("button");
    cancelBtn.className = "btn-cancel";
    cancelBtn.textContent = "Cancel";
    cancelBtn.addEventListener("click", () => closeDraft());
    actions.appendChild(cancelBtn);

    const saveBtn = document.createElement("button");
    saveBtn.className = "btn-save";
    saveBtn.textContent = "Comment";
    saveBtn.addEventListener("click", () => saveDraft(textarea.value));
    actions.appendChild(saveBtn);

    draftEl.appendChild(actions);
    sidebar.appendChild(draftEl);

    // Focus after layout
    requestAnimationFrame(() => textarea.focus());

    // Ctrl/Cmd+Enter to save
    textarea.addEventListener("keydown", (e) => {
      if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
        e.preventDefault();
        saveDraft(textarea.value);
      }
      if (e.key === "Escape") {
        e.preventDefault();
        closeDraft();
      }
    });
  }

  function saveDraft(comment) {
    if (!draft || !comment.trim()) return;

    const annotation = {
      id: nextId++,
      selectedText: draft.selectedText,
      range: draft.range,
      context: draft.context,
      comment: comment.trim(),
      markEl: null,
    };

    applyHighlight(annotation);
    annotations.push(annotation);
    draft = null;
    sidebar.querySelector(".comment-draft")?.remove();
    renderSidebar();
  }

  function closeDraft() {
    draft = null;
    sidebar.querySelector(".comment-draft")?.remove();
    updateBodyClasses();
  }

  // ── Selection handling ──

  function hideTrigger() {
    trigger.classList.remove("visible");
  }

  function showTrigger(x, y) {
    trigger.style.left = x + "px";
    trigger.style.top = y + "px";
    trigger.classList.add("visible");
  }

  document.addEventListener("mouseup", (e) => {
    // Ignore clicks in sidebar or on trigger
    if (
      e.target.closest("#comments-sidebar") ||
      e.target.closest(".comment-trigger") ||
      e.target.closest(".done-button")
    ) {
      return;
    }

    const sel = window.getSelection();
    if (!sel || sel.isCollapsed || !sel.toString().trim()) {
      // Small delay so clicking trigger works
      setTimeout(hideTrigger, 150);
      return;
    }

    const range = sel.getRangeAt(0);
    const rect = range.getBoundingClientRect();

    // Position trigger to the right of the selection
    const x = rect.right + 6 + window.scrollX;
    const y = rect.top + (rect.height / 2) - 14 + window.scrollY;
    showTrigger(x, y);
  });

  trigger.addEventListener("mousedown", (e) => {
    e.preventDefault(); // Don't clear selection
  });

  trigger.addEventListener("click", () => {
    const sel = window.getSelection();
    if (!sel || sel.isCollapsed) {
      hideTrigger();
      return;
    }

    const range = sel.getRangeAt(0);
    const selectedText = sel.toString().trim();
    const context = getBlockContext(range.startContainer);

    hideTrigger();
    sel.removeAllRanges();

    openDraft(selectedText, range, context);
  });

  // ── Done button override ──

  if (doneButton) {
    // Remove the inline onclick
    doneButton.removeAttribute("onclick");
    doneButton.addEventListener("click", () => {
      if (!window.glimpse) return;

      const payload = annotations.map((a) => ({
        selectedText: a.selectedText,
        comment: a.comment,
        context: {
          type: a.context.type,
          ...(a.context.type === "diff"
            ? {
                file: a.context.file,
                lineNumber: a.context.lineNumber,
                lineText: a.context.lineText,
              }
            : {
                blockIndex: a.context.blockIndex,
                blockTag: a.context.blockTag,
                blockText: a.context.blockText,
              }),
        },
      }));

      window.glimpse.send({ action: "done", annotations: payload });
      window.glimpse.close();
    });
  }
})();
