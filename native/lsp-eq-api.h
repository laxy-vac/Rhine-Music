#ifndef RHINE_LSP_EQ_API_H
#define RHINE_LSP_EQ_API_H

#include <stdint.h>

#if defined(_WIN32)
  #if defined(RHINE_LSP_EQ_BUILD)
    #define RHINE_LSP_EQ_EXPORT __declspec(dllexport)
  #else
    #define RHINE_LSP_EQ_EXPORT __declspec(dllimport)
  #endif
  #define RHINE_LSP_EQ_CALL __cdecl
#else
  #define RHINE_LSP_EQ_EXPORT __attribute__((visibility("default")))
  #define RHINE_LSP_EQ_CALL
#endif

#ifdef __cplusplus
extern "C" {
#endif

/* The ABI is intentionally limited to C-compatible values. */
RHINE_LSP_EQ_EXPORT uint32_t RHINE_LSP_EQ_CALL rhine_lsp_eq_version(void);

/*
 * configJson accepts either the eq.lsp object itself or {"eq":{"lsp":...}}.
 * channels is 1 (mono) or 2 (stereo); M/S routing requires 2 channels.
 * On failure, create returns NULL and writes a short UTF-8 error if possible.
 */
RHINE_LSP_EQ_EXPORT void *RHINE_LSP_EQ_CALL rhine_lsp_eq_create(
    const char *configJson,
    uint32_t sampleRate,
    uint32_t channels,
    char *error,
    uint32_t errorCapacity);

RHINE_LSP_EQ_EXPORT void RHINE_LSP_EQ_CALL rhine_lsp_eq_destroy(void *instance);
RHINE_LSP_EQ_EXPORT void RHINE_LSP_EQ_CALL rhine_lsp_eq_reset(void *instance);

/* Mutates interleaved float64 PCM in place. Zero is success. */
RHINE_LSP_EQ_EXPORT int RHINE_LSP_EQ_CALL rhine_lsp_eq_process(
    void *instance,
    double *interleaved,
    uint32_t frames);

RHINE_LSP_EQ_EXPORT uint32_t RHINE_LSP_EQ_CALL rhine_lsp_eq_latency(void *instance);

/*
 * bandIndex == -1 returns total magnitude response including preamp/output.
 * Otherwise 0..31 returns that band's response (0 dB if disabled).
 * channel is a zero-based DSP lane; in M/S mode 0=M and 1=S.
 * Frequencies are Hz. Zero is success.
 */
RHINE_LSP_EQ_EXPORT int RHINE_LSP_EQ_CALL rhine_lsp_eq_response(
    void *instance,
    int32_t bandIndex,
    uint32_t channel,
    const float *frequencies,
    float *db,
    uint32_t count);

#ifdef __cplusplus
}
#endif

#endif /* RHINE_LSP_EQ_API_H */
