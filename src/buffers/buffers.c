#include <defines.h> /* NUM_PLAYERS, which sizes the per-screen buffers */
#include <libultraship.h>
#include <macros.h>
#include <mk64.h>
#include "buffers.h"

/**
 * @brief look like to be a buffer of decoded textures
 */
ALIGNED8 union_D_802BFB80 D_802BFB80;
/* The middle dimension of both of these is the screen, and both were sized for
   the old viewport cap rather than the roster -- two screens here, four below.
   The player dimension was always eight. render_player() indexes these by
   screenId on its very first line, so a fifth viewport reads past the middle
   dimension and hands the result on as a palette pointer. */
// [nothing][screen][player]
ALIGNED8 struct_D_802DFB80 gEncodedKartTexture[2][NUM_PLAYERS][NUM_PLAYERS];
#ifdef AVOID_UB
// [buffer][screen][player] Buffer might be two separate buffers or something?
ALIGNED8 struct_D_802F1F80 gPlayerPalettesList[2][NUM_PLAYERS][NUM_PLAYERS];
#else
ALIGNED8 u16 gPlayerPalettesList[2][NUM_PLAYERS][0x100 * 8];
#endif

ALIGNED8 u16 gZBuffer[SCREEN_WIDTH * SCREEN_HEIGHT];

#ifdef AVOID_UB
ALIGNED8 u16 gFramebuffers[3][SCREEN_WIDTH * SCREEN_HEIGHT];
#else
u16 gFramebuffer0[SCREEN_WIDTH * SCREEN_HEIGHT];
u16 gFramebuffer1[SCREEN_WIDTH * SCREEN_HEIGHT];
u16 gFramebuffer2[SCREEN_WIDTH * SCREEN_HEIGHT];
#endif
