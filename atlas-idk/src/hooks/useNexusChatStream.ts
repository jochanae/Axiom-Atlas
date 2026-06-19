se64, mediaType: imageMimeType || "image/png" }]
            : []);
    if ((!text.trim() && imgAttachments.length === 0) || isPending) return;
    const firstImg = imgAttachments[0];

    // Backend requires a non-empty `message` field even when only images are attached.
    const effectiveText = text.trim().length > 0
      ? text
      : (imgAttachments.length > 0 ? "(image attached)" : text);
    const routedText = imgAttachments.length > 0 ? effectiveText : routeDirectImageRequestToSketchPrompt(effectiveText);

    const resolvedModel = overrideOptions?.model ?? model;
    const resolvedMode = overrideOptions?.mode ?? mode;
    const history = messagesRef.current.map((m) => ({ role: m.role, content: m.content }));
    const userProfile = profileToString(loadProfile());

    setIsPending(true);
    setIsStreaming(true);
    const streamingId = Date.now().toString();
    streamingIdRef.current = streamingId;
    stepSeqRef.current = 0;
    cleanedUpRef.current = false;
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      if (cleanedUpRef.current || streamingIdRef.current !== streamingId) return;

      abortStream();
      setMessages(prev => prev.map(m =>
        (m as any).id === streamingId
          ? {
              ...m,
              content: "Connection timed out. Tap send again to retry.",
              streaming: false,
              runStatus: "failed",
              errorMessage: "Stream timed out.",
            }
          : m
      ));
      resetStreamState();
    }, STREAM_TIMEOUT_MS);

    // Add user message
    const userMsg: NexusMessage = {
      role: "user",
      content: text,
      createdAt: new Date().toISOString(),
      ...(imgAttachments.length > 0
        ? {
            attachments: imgAttachments,
            imageUrl: `data:${firstImg!.mediaType};base64,${firstImg!.base64}`,
          }
        : {}),
    };
    setMessages(prev => [...prev, userMsg]);

    // ── Frontend short-circuit for image requests ─────────────────
    // /api/chat does not generate images. Route direct image
    // asks (and explicit [SKETCH:*] picks) to /api/image/generate
    // and render the result inline as an assistant message.
    const isImageIntent = imgAttachments.length === 0 && (shouldAutoRouteToSketchPrompt(text) || SKETCH_PROMPT_MARKER_RE.test(text));
    if (isImageIntent) {
      const sketchPreset = (text.match(SKETCH_PROMPT_MARKER_RE)?.[1] ?? routedText.match(SKETCH_PROMPT_MARKER_RE)?.[1])?.toLowerCase();
      const imgPrompt = extractSketchSubject(SKETCH_PROMPT_MARKER_RE.test(text) ? text : routedText);
      const styleLabel = (sketchPreset ?? "concept").replace(/^\w/, c => c.toUpperCase());
      const pushStep = (verb: string, target?: string) => {
        const step: NexusLiveStep = { id: `${Date.now()}-${verb}`, verb, target };
        setLiveStep(step);
        setLiveSteps(prev => [...prev, step].slice(-6));
      };
      pushStep("Interpreting", `"${imgPrompt.slice(0, 48)}${imgPrompt.length > 48 ? "…" : ""}"`);
      try {
        pushStep("Sketching", `${styleLabel} style`);
        const { generateImage } = await import("@/lib/generateImage");
        const img = await generateImage(imgPrompt, {
          style: (sketchPreset as "concept" | "wireframe" | "moodboard" | "blueprint" | "photoreal" | undefined) ?? "concept",
        });
        pushStep("Rendering", "image");
        setMessages(prev => [...prev, {
          id: streamingId,
          role: "assistant",
          content: "",
          createdAt: new Date().toISOString(),
          model: resolvedModel,
          imageUrl: img.dataUrl,
          imageGen: { images: [{ imageUrl: img.dataUrl, prompt: imgPrompt }] },
          isNew: true,
        } as NexusMessage]);
      } catch (err: any) {
        console.error("[useNexusChatStream] image generate failed:", err);
        setMessages(prev => [...prev, {
          id: streamingId,
          role: "assistant",
          content: `Image generation failed: ${err?.message ?? "unknown error"}`,
          createdAt: new Date().toISOString(),
          model: resolvedModel,
        } as NexusMessage]);
      } finally {
        if (timeoutRef.current) clearTimeout(timeoutRef.current);
        setIsPending(false);
        setIsStreaming(false);
        resetStreamState();
      }
      return;
    }

    // Add streaming assistant bubble
    const assistantMsg: NexusMessage = {
      id: streamingId,
      role: "assistant",
      content: "",
      createdAt: new Date().toISOString(),
      streaming: true,
      model: resolvedModel,
      isNew: true,
    };
    setMessages(prev => [...prev, assistantMsg]);

    try {
      await stream({
        endpoint: "/api/chat",
        body: {
          message: routedText,
          history,
          userProfile,
          model: resolvedModel,
          mode: resolvedMode,
          ...(imgAttachments.length > 0
            ? {
                attachments: imgAttachments,
                // Legacy fields for pre-multi-image backend builds.
                imageData: firstImg!.base64,
                imageMimeType: firstImg!.mediaType,
              }
            : {}),
        },

        callbacks: {
          onToken: (released) => {
            const cleaned = stripNavigateTo(released)
              .content
              .split('\n')
              .filter(line => {
                const t = line.trim();
                return !t.startsWith('VISUALIZE:') &&
                       !t.startsWith('READY_TO_SHAPE:') &&
                       !t.startsWith('NAVIGATE_TO:') &&
                       !t.startsWith('MEMORY_CHIPS:');
              })
              .join('\n')
              .replace(/VISUALIZE:\{[\s\S]*$/g, '')
              .replace(/READY_TO_SHAPE:\{[\s\S]*$/g, '');
            setMessages(prev => prev.map(m =>
              (m as any).id === streamingId
                ? { ...m, content: cleaned }
                : m
            ));
          },
          onStep: (step) => {
            const nextStep: NexusLiveStep = {
              id: `${streamingId}-${stepSeqRef.current++}`,
              verb: step.verb ?? "",
              target: step.target,
              detail: step.detail,
              status: step.status,
            };
            setLiveStep(nextStep);
            setLiveSteps(prev => [...prev, nextStep].slice(-6));
          },
          onDone: (fullText, meta) => {
            if (meta && !(meta as any).imageGen && (meta as any).image_gen) {
              (meta as any).imageGen = (meta as any).image_gen;
            }
            const doneConversationId = meta.conversationId;
            if (!activeConversationIdRef.current && typeof doneConversationId === "string" && doneConversationId) {
              activeConversationIdRef.current = doneConversationId;
            }

            const { content: navCleanedText, route } = stripNavigateTo(fullText);
            let displayText = navCleanedText;
            if (route) setTimeout(() => { window.location.href = route; }, 800);

            // Read shapingPayload from meta — backend parses and 
            // sends it in the done event already cleaned
            const shapingFromMeta = meta.shapingPayload as NexusShapingPayload | null | undefined;
            if (shapingFromMeta?.title && shapingFromMeta?.tension && !shapingHeldRef.current) {
              setShapingPayload(shapingFromMeta);
            }

            // Parse VISUALIZE marker
            const visualMatch = fullText.match(
              /VISUALIZE:\{([\s\S]*?)\}(?:\s|$)/
            ) || fullText.match(
              /VISUALIZE:(\{[\s\S]*\})/
            );
            if (visualMatch) {
              let visualData: { prompt: string; caption: string } | null = null;
              try {
                const rawJson = visualMatch[1].startsWith('{')
                  ? visualMatch[1]
                  : `{${visualMatch[1]}}`;
                visualData = JSON.parse(rawJson);
              } catch {
                const promptMatch = fullText.match(/"prompt":"([^"]+)"/);
                const captionMatch = fullText.match(/"caption":"([^"]+)"/);
                if (promptMatch) {
                  visualData = {
                    prompt: promptMatch[1],
                    caption: captionMatch?.[1] ?? "",
                  };
                }
              }

                if (visualData?.prompt) {
                  // Set loading state on the message
                  setMessages(prev => prev.map(m =>
                    (m as any).id === streamingId
                      ? { 
                          ...m, 
                          visualLoading: true,
                          visualCaption: visualData.caption ?? null,
                        }
                      : m
                  ));

                  // Fetch the image async — don't block onDone
                  fetch("/api/nexus/visualize", {
                    method: "POST",
                    credentials: "include",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ 
                      prompt: visualData.prompt 
                    }),
                  })
                    .then(r => r.ok ? r.json() : null)
                    .then((data: { 
                      imageBase64?: string; 
                      mimeType?: string 
                    } | null) => {
                      if (data?.imageBase64) {
                        setMessages(prev => prev.map(m =>
                          (m as any).id === streamingId
                            ? {
                                ...m,
                                visualLoading: false,
                                visualImageBase64: data.imageBase64,
                              }
                            : m
                        ));
                      } else {
                        setMessages(prev => prev.map(m =>
                          (m as any).id === streamingId
                            ? { ...m, visualLoading: false }
                            : m
                        ));
                      }
                    })
                    .catch(() => {
                      setMessages(prev => prev.map(m =>
                        (m as any).id === streamingId
                          ? { ...m, visualLoading: false }
                          : m
                      ));
                    });
                }
            }


            // Parse MEMORY_CHIPS
            const chipMatch = displayText.match(/MEMORY_CHIPS:\s*(\[[\s\S]*?\])/);
            if (chipMatch) {
              try { JSON.parse(chipMatch[1]); } catch { /* non-fatal */ }
              displayText = displayText.replace(/\nMEMORY_CHIPS:[\s\S]*$/g, "").trim();
            }

            const handoff = meta.handoffSignal as NexusHandoffSignal | undefined;
            if (handoff) setHandoffSignal(handoff);
            const focusSuggestion = meta.focusSuggestion as NexusFocusSuggestion | undefined;

            setMessages(prev => prev.map(m =>
              (m as any).id === streamingId
                ? {
                    ...m,
                    content: displayText,
                    imageGen: ((meta as any).imageGen ?? null) as NexusMessage["imageGen"],
                    streaming: false,
                    handoffSignal: handoff ?? null,
                    focusSuggestion,
                    surface: (meta.surface ?? null) as string | null,
                    executionTimeMs: (meta.executionTimeMs ?? meta.execution_time_ms ?? null) as number | null,
                    inputTokens: (meta.inputTokens ?? meta.input_tokens ?? null) as number | null,
                    outputTokens: (meta.outputTokens ?? meta.output_tokens ?? null) as number | null,
                    costUsd: (meta.costUsd ?? (meta.cost_usd != null ? Number(meta.cost_usd) : null)) as number | null,
                    runStatus: (meta.runStatus ?? meta.run_status ?? "completed") as string,
                    runSummary: (meta.runSummary ?? meta.run_summary ?? null) as string | null,
                    modelUsed: (meta.modelUsed ?? meta.model_used ?? null) as string | null,
                  }
                : m
            ));

            resetStreamState();
          },
          onError: (errMsg) => {
            setMessages(prev => prev.map(m =>
              (m as any).id === streamingId
                ? {
                    ...m,
                    content: errMsg || "Something went wrong. Tap send again.",
                    streaming: false,
                    runStatus: "failed",
                    errorMessage: errMsg,
                  }
                : m
            ));
            resetStreamState();
          },
        },
      });
    } finally {
      // Always reset — even if stream threw unexpectedly
      resetStreamState();
    }
  }, [isPending, model, mode, stream, abortStream, resetStreamState]);

  return {
    messages,
    setMessages,
    isStreaming,
    isPending,
    liveStep,
    liveSteps,
    shapingPayload,
    setShapingPayload,
    shapingHeld,
    setShapingHeld,
    handoffSignal,
    send,
    abort,
    clearMessages,
  };
}
 