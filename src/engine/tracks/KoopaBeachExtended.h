#pragma once

#include "engine/tracks/KoopaTroopaBeach.h"

/**
 * Koopa Troopa Beach with the far hairpin opened into a bay.
 * The original rock ramp is untouched. A second ramp sits on the
 * inside of the new bay and jumps across it.
 */
class KoopaBeachExtended : public KoopaTroopaBeach {
public:
    explicit KoopaBeachExtended();

    virtual void Load() override;
    virtual void BeginPlay() override;
    virtual void Draw(ScreenContext*) override;
    virtual void DrawTransparency(ScreenContext* screen, uint16_t pathCounter, uint16_t cameraRot,
                                  uint16_t playerDirection) override;
};
