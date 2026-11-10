#include <libultraship.h>
#include <libultra/gbi.h>
#include <cmath>
#include <vector>

#include "KoopaBeachExtended.h"
#include "assets/models/tracks/koopa_troopa_beach/koopa_troopa_beach_data.h"
#include "assets/other/tracks/koopa_troopa_beach/koopa_troopa_beach_data.h"
#include "assets/models/tracks/koopa_troopa_beach/koopa_troopa_beach_displaylists.h"

extern "C" {
#include "main.h"
#include "code_800029B0.h"
#include "racing/render_courses.h"
#include "racing/collision.h"
#include "racing/actors.h"
#include "defines.h"
#include "assets/models/common_data.h"
extern const char* d_course_koopa_troopa_beach_dl_list1[148];
extern const char* koopa_troopa_beach_dls2[148];
}

namespace {

struct Pt {
    float x, y, z;
};

struct Col {
    u8 r, g, b, a;
};

constexpr Col kSand = { 232, 206, 140, 255 };
constexpr Col kRamp = { 214, 198, 164, 255 };
constexpr Col kRock = { 118, 106, 94, 255 };
constexpr Col kWater = { 64, 146, 198, 150 };

constexpr int kMaxVtx = 2500;
constexpr int kMaxGfx = 2500;
constexpr float kRoadHalfWidth = 240.0f;
constexpr float kPathStep = 20.0f;

struct Mesh {
    Vtx vtx[kMaxVtx];
    Gfx gfx[kMaxGfx];
    int nv;
    int ng;
    bool mirror;
    bool overflow;

    void reset(bool isMirror) {
        nv = 0;
        ng = 0;
        mirror = isMirror;
        overflow = false;
    }

    void tri(Pt a, Pt b, Pt c, Col col) {
        if (overflow) {
            return;
        }
        if ((nv + 3 > kMaxVtx) || (ng + 3 > kMaxGfx)) {
            overflow = true;
            return;
        }
        if (mirror) {
            a.x = -a.x;
            b.x = -b.x;
            c.x = -c.x;
            Pt swap = b;
            b = c;
            c = swap;
        }
        Vtx* base = &vtx[nv];
        Pt pts[3] = { a, b, c };
        for (int i = 0; i < 3; i++) {
            Vtx* v = &vtx[nv++];
            v->v.ob[0] = (s16) pts[i].x;
            v->v.ob[1] = (s16) pts[i].y;
            v->v.ob[2] = (s16) pts[i].z;
            v->v.flag = 0;
            v->v.tc[0] = 0;
            v->v.tc[1] = 0;
            v->v.cn[0] = col.r;
            v->v.cn[1] = col.g;
            v->v.cn[2] = col.b;
            v->v.cn[3] = col.a;
        }
        Gfx* gp = &gfx[ng];
        gSPVertex(gp++, (uintptr_t) base, 3, 0);
        gSP1Triangle(gp++, 0, 1, 2, 0);
        ng = (int) (gp - gfx);
    }

    void end() {
        if (ng + 1 > kMaxGfx) {
            overflow = true;
            return;
        }
        Gfx* gp = &gfx[ng];
        gSPEndDisplayList(gp++);
        ng = (int) (gp - gfx);
    }
};

float cross_y(Pt a, Pt b, Pt c) {
    float abx = b.x - a.x;
    float abz = b.z - a.z;
    float acx = c.x - a.x;
    float acz = c.z - a.z;
    return (abz * acx) - (abx * acz);
}

void quad_up(Mesh& mesh, Pt a, Pt b, Pt c, Pt d, Col col) {
    if (cross_y(a, b, c) >= 0.0f) {
        mesh.tri(a, b, c, col);
        mesh.tri(a, c, d, col);
    } else {
        mesh.tri(a, c, b, col);
        mesh.tri(a, d, c, col);
    }
}

void quad_both(Mesh& mesh, Pt a, Pt b, Pt c, Pt d, Col col) {
    mesh.tri(a, b, c, col);
    mesh.tri(a, c, b, col);
    mesh.tri(a, c, d, col);
    mesh.tri(a, d, c, col);
}

void add_box(Mesh& mesh, float cx, float y0, float y1, float cz, float hx, float hz, Col col) {
    float x0 = cx - hx;
    float x1 = cx + hx;
    float z0 = cz - hz;
    float z1 = cz + hz;
    Pt c000 = { x0, y0, z0 };
    Pt c100 = { x1, y0, z0 };
    Pt c110 = { x1, y1, z0 };
    Pt c010 = { x0, y1, z0 };
    Pt c001 = { x0, y0, z1 };
    Pt c101 = { x1, y0, z1 };
    Pt c111 = { x1, y1, z1 };
    Pt c011 = { x0, y1, z1 };

    quad_both(mesh, c000, c100, c110, c010, col);
    quad_both(mesh, c100, c101, c111, c110, col);
    quad_both(mesh, c101, c001, c011, c111, col);
    quad_both(mesh, c001, c000, c010, c011, col);
    quad_up(mesh, c010, c110, c111, c011, col);
}

void side_offsets(Pt from, Pt to, float half, float& ox, float& oz) {
    float dx = to.x - from.x;
    float dz = to.z - from.z;
    float len = sqrtf((dx * dx) + (dz * dz));
    if (len < 1.0f) {
        ox = half;
        oz = 0.0f;
        return;
    }
    ox = (dz / len) * half;
    oz = (-dx / len) * half;
}

void add_ribbon(Mesh& mesh, const std::vector<Pt>& line, float half, Col col) {
    if (line.size() < 2) {
        return;
    }
    for (size_t i = 0; i + 1 < line.size(); i++) {
        Pt a = line[i];
        Pt b = line[i + 1];
        Pt c = (i + 2 < line.size()) ? line[i + 2] : b;
        float ox, oz, ox2, oz2;
        side_offsets(a, b, half, ox, oz);
        side_offsets(b, c, half, ox2, oz2);
        Pt l0 = { a.x - ox, a.y, a.z - oz };
        Pt r0 = { a.x + ox, a.y, a.z + oz };
        Pt l1 = { b.x - ox2, b.y, b.z - oz2 };
        Pt r1 = { b.x + ox2, b.y, b.z + oz2 };
        quad_up(mesh, l0, r0, r1, l1, col);
    }
}

void append_segment(std::vector<Pt>& out, Pt a, Pt b, float step) {
    float dx = b.x - a.x;
    float dy = b.y - a.y;
    float dz = b.z - a.z;
    float len = sqrtf((dx * dx) + (dz * dz));
    int pieces = (int) (len / step);
    if (pieces < 1) {
        pieces = 1;
    }
    for (int i = 1; i <= pieces; i++) {
        float t = (float) i / (float) pieces;
        Pt p = { a.x + (dx * t), a.y + (dy * t), a.z + (dz * t) };
        if (!out.empty()) {
            float ddx = p.x - out.back().x;
            float ddz = p.z - out.back().z;
            if (((ddx * ddx) + (ddz * ddz)) < 4.0f) {
                out.back() = p;
                continue;
            }
        }
        out.push_back(p);
    }
}

bool is_end(const TrackPathPoint& p) {
    return ((u16) p.x == 0x8000) && ((u16) p.y == 0x8000) && ((u16) p.z == 0x8000);
}

Mesh gRoad;
Mesh gRamp;
Mesh gRock;
Mesh gWater;

TrackPathPoint gPath[1600];
int gPathCount = 0;
bool gBuilt = false;

Vec3s gItemBoxes[2];
Vec3s gPalms[3];

void collide(Mesh& mesh, s8 surface) {
    D_8015F59C = 0;
    D_8015F5A0 = 0;
    D_8015F5A4 = 0;
    if (mesh.overflow || (mesh.ng < 2)) {
        return;
    }
    generate_collision_mesh(mesh.gfx, surface, 1);
}

void build_extension(void) {
    gBuilt = false;
    gPathCount = 0;
    bool mirror = (gIsMirrorMode != 0);
    gRoad.reset(mirror);
    gRamp.reset(mirror);
    gRock.reset(mirror);
    gWater.reset(mirror);

    TrackPathPoint* src = (TrackPathPoint*) LOAD_ASSET_RAW(d_course_koopa_troopa_beach_track_waypoints);
    if (src == NULL) {
        printf("[koopa beach extended] missing the stock path\n");
        return;
    }

    std::vector<Pt> orig;
    for (int i = 0; i < 3000; i++) {
        if (is_end(src[i])) {
            break;
        }
        if (src[i].y >= 80) {
            Pt prev = orig.empty() ? Pt{ (float) src[i].x, 0.0f, (float) src[i].z } : orig.back();
            orig.push_back({ (float) src[i].x, prev.y, (float) src[i].z });
            continue;
        }
        orig.push_back({ (float) src[i].x, (float) src[i].y, (float) src[i].z });
    }
    if (orig.size() < 32) {
        printf("[koopa beach extended] stock path is too short\n");
        return;
    }

    int apex = -1;
    for (int i = 0; i < (int) orig.size(); i++) {
        if ((orig[i].y < 80.0f) && ((apex < 0) || (orig[i].x > orig[apex].x))) {
            apex = i;
        }
    }
    int rejoin = -1;
    for (int i = apex + 1; i < (int) orig.size(); i++) {
        if (orig[i].z >= 0.0f) {
            rejoin = i;
            break;
        }
    }
    if ((apex < 8) || (rejoin < 0) || ((rejoin + 8) >= (int) orig.size())) {
        printf("[koopa beach extended] could not find the far turn\n");
        return;
    }

    Pt tip = orig[apex];
    Pt back = orig[rejoin];
    Pt controls[8] = {
        tip,
        { tip.x + 430.0f, tip.y - 4.0f, tip.z - 70.0f },
        { tip.x + 930.0f, tip.y - 8.0f, tip.z - 10.0f },
        { tip.x + 1330.0f, tip.y - 10.0f, tip.z + 430.0f },
        { tip.x + 1180.0f, tip.y - 10.0f, tip.z + 810.0f },
        { tip.x + 630.0f, tip.y - 6.0f, tip.z + 850.0f },
        { tip.x + 180.0f, tip.y - 2.0f, tip.z + 670.0f },
        back,
    };

    std::vector<Pt> loop;
    loop.push_back(controls[0]);
    for (int i = 0; i < 7; i++) {
        append_segment(loop, controls[i], controls[i + 1], kPathStep);
    }
    if (!loop.empty()) {
        loop.back() = back;
    }
    if (loop.size() < 4) {
        return;
    }

    std::vector<Pt> ribbon;
    for (int i = apex - 6; i <= apex; i++) {
        ribbon.push_back(orig[i]);
    }
    for (size_t i = 1; i + 1 < loop.size(); i++) {
        ribbon.push_back(loop[i]);
    }
    for (int i = rejoin; (i <= (rejoin + 6)) && (i < (int) orig.size()); i++) {
        ribbon.push_back(orig[i]);
    }
    add_ribbon(gRoad, ribbon, kRoadHalfWidth, kSand);

    /* Second secret: a ramp on the inside edge of the north shore, across
       the bay, onto a beach that climbs back onto the south shore. */
    Pt north = controls[2];
    Pt south = controls[4];
    float ix = south.x - north.x;
    float iz = south.z - north.z;
    float ilen = sqrtf((ix * ix) + (iz * iz));
    if (ilen < 1.0f) {
        ilen = 1.0f;
    }
    ix /= ilen;
    iz /= ilen;
    float px = iz;
    float pz = -ix;

    float mouthDist = kRoadHalfWidth * 0.72f;
    Pt mouth = { north.x + (ix * mouthDist), north.y, north.z + (iz * mouthDist) };
    Pt lip = { mouth.x + (ix * 200.0f), mouth.y + 150.0f, mouth.z + (iz * 200.0f) };
    Pt beach0 = { lip.x + (ix * 220.0f), 2.0f, lip.z + (iz * 220.0f) };
    Pt beach1 = { beach0.x + (ix * 180.0f), south.y, beach0.z + (iz * 180.0f) };
    Pt pad = { beach1.x + (ix * 220.0f), south.y, beach1.z + (iz * 220.0f) };

    auto ramp_quad = [&](Pt from, Pt to, float half, Col col, Mesh& mesh) {
        Pt l0 = { from.x - (px * half), from.y, from.z - (pz * half) };
        Pt r0 = { from.x + (px * half), from.y, from.z + (pz * half) };
        Pt l1 = { to.x - (px * half), to.y, to.z - (pz * half) };
        Pt r1 = { to.x + (px * half), to.y, to.z + (pz * half) };
        quad_up(mesh, l0, r0, r1, l1, col);
    };
    ramp_quad(mouth, lip, 90.0f, kRamp, gRamp);
    ramp_quad(beach0, beach1, 200.0f, kSand, gRoad);
    ramp_quad(beach1, pad, 220.0f, kSand, gRoad);

    /* Rocks across the old hairpin, so the lap has to take the bay. */
    add_box(gRock, tip.x, tip.y + 20.0f, tip.y + 230.0f, tip.z + 380.0f, 360.0f, 70.0f, kRock);
    /* A rock beside the ramp, on the outside of the north shore. */
    add_box(gRock, north.x, north.y, north.y + 90.0f, north.z - 320.0f, 70.0f, 50.0f, kRock);
    add_box(gRock, north.x + 160.0f, north.y, north.y + 70.0f, north.z - 280.0f, 50.0f, 40.0f, kRock);

    float minX = loop[0].x;
    float maxX = loop[0].x;
    float minZ = loop[0].z;
    float maxZ = loop[0].z;
    for (const Pt& p : loop) {
        if (p.x < minX) minX = p.x;
        if (p.x > maxX) maxX = p.x;
        if (p.z < minZ) minZ = p.z;
        if (p.z > maxZ) maxZ = p.z;
    }
    Pt w00 = { minX - 500.0f, -1.0f, minZ - 500.0f };
    Pt w10 = { maxX + 500.0f, -1.0f, minZ - 500.0f };
    Pt w11 = { maxX + 500.0f, -1.0f, maxZ + 500.0f };
    Pt w01 = { minX - 500.0f, -1.0f, maxZ + 500.0f };
    quad_up(gWater, w00, w10, w11, w01, kWater);

    gRoad.end();
    gRamp.end();
    gRock.end();
    gWater.end();

    collide(gRoad, (s8) SAND);
    collide(gRamp, (s8) RAMP);
    collide(gRock, (s8) CLIFF);

    int out = 0;
    for (int i = 0; (i <= apex) && (out < 1598); i++) {
        gPath[out].x = src[i].x;
        gPath[out].y = src[i].y;
        gPath[out].z = src[i].z;
        gPath[out].trackSectionId = src[i].trackSectionId;
        out++;
    }
    for (size_t i = 1; (i + 1 < loop.size()) && (out < 1598); i++) {
        gPath[out].x = (s16) loop[i].x;
        gPath[out].y = (s16) loop[i].y;
        gPath[out].z = (s16) loop[i].z;
        gPath[out].trackSectionId = 1;
        out++;
    }
    for (int i = rejoin; (i < (int) orig.size()) && (out < 1598); i++) {
        gPath[out].x = src[i].x;
        gPath[out].y = src[i].y;
        gPath[out].z = src[i].z;
        gPath[out].trackSectionId = src[i].trackSectionId;
        out++;
    }
    gPath[out].x = (s16) 0x8000;
    gPath[out].y = (s16) 0x8000;
    gPath[out].z = (s16) 0x8000;
    gPath[out].trackSectionId = 0;
    gPathCount = out;

    gItemBoxes[0][0] = (s16) (tip.x + 280.0f);
    gItemBoxes[0][1] = (s16) (tip.y + 40.0f);
    gItemBoxes[0][2] = (s16) (tip.z - 40.0f);
    gItemBoxes[1][0] = (s16) mouth.x;
    gItemBoxes[1][1] = (s16) (mouth.y + 40.0f);
    gItemBoxes[1][2] = (s16) mouth.z;
    gPalms[0][0] = (s16) (controls[3].x + 280.0f);
    gPalms[0][1] = 40;
    gPalms[0][2] = (s16) controls[3].z;
    gPalms[1][0] = (s16) controls[5].x;
    gPalms[1][1] = 40;
    gPalms[1][2] = (s16) (controls[5].z + 320.0f);
    gPalms[2][0] = (s16) (north.x - 40.0f);
    gPalms[2][1] = 40;
    gPalms[2][2] = (s16) (north.z - 340.0f);

    gBuilt = !gRoad.overflow && !gRamp.overflow && !gRock.overflow;
    printf("[koopa beach extended] path %d points (stock far turn was %d..%d)\n", gPathCount, apex, rejoin);
    if (!gBuilt) {
        printf("[koopa beach extended] mesh overflow, extension collision was skipped\n");
    }
}

void draw_opaque(Mesh& mesh) {
    if (!gBuilt || mesh.overflow || (mesh.ng < 2)) {
        return;
    }
    gSPDisplayList(gDisplayListHead++, mesh.gfx);
}

} // namespace

KoopaBeachExtended::KoopaBeachExtended() {
    ResourceName = "mk:koopa_beach_extended";
    Props.SetText(Props.Name, "koopa beach extended", sizeof(Props.Name));
    Props.SetText(Props.DebugName, "beach ext", sizeof(Props.DebugName));
    Props.SetText(Props.TrackLength, "860m", sizeof(Props.TrackLength));
    /* Room for the stock path plus the bay. The real count is written in Load. */
    Props.PathSizes.unk0 = 1500;
}

void KoopaBeachExtended::Load() {
    Track::Load();
    if (gIsMirrorMode != 0) {
        for (size_t i = 0; i < ARRAY_COUNT(d_course_koopa_troopa_beach_dl_list1); i++) {
            InvertTriangleWindingByName(d_course_koopa_troopa_beach_dl_list1[i]);
        }
        for (size_t i = 0; i < ARRAY_COUNT(koopa_troopa_beach_dls2); i++) {
            InvertTriangleWindingByName(koopa_troopa_beach_dls2[i]);
        }
        InvertTriangleWindingByName(d_course_koopa_troopa_beach_packed_dl_9CC0);
        InvertTriangleWindingByName(d_course_koopa_troopa_beach_packed_dl_9688);
        InvertTriangleWindingByName(d_course_koopa_troopa_beach_packed_dl_2C0);
        InvertTriangleWindingByName(d_course_koopa_troopa_beach_packed_dl_9E70);
    }

    parse_track_displaylists((TrackSections*) LOAD_ASSET_RAW(d_course_koopa_troopa_beach_addr));
    build_extension();
    if (gBuilt) {
        Props.PathTable2[0] = gPath;
    }
    find_vtx_and_set_colours((Gfx*) d_course_koopa_troopa_beach_packed_dl_ADE0, 150, 255, 255, 255);
    find_vtx_and_set_colours((Gfx*) d_course_koopa_troopa_beach_packed_dl_A540, 150, 255, 255, 255);
    find_vtx_and_set_colours((Gfx*) d_course_koopa_troopa_beach_packed_dl_9E70, 150, 255, 255, 255);
    find_vtx_and_set_colours((Gfx*) d_course_koopa_troopa_beach_packed_dl_358, 150, 255, 255, 255);
    func_80295C6C();
}

void KoopaBeachExtended::BeginPlay() {
    KoopaTroopaBeach::BeginPlay();
    if (!gBuilt) {
        return;
    }

    ActorSpawnData boxes[] = {
        { { gItemBoxes[0][0], gItemBoxes[0][1], gItemBoxes[0][2] }, { 0 } },
        { { gItemBoxes[1][0], gItemBoxes[1][1], gItemBoxes[1][2] }, { 1 } },
        { { END_OF_SPAWN_DATA, 0, 0 }, { 0 } },
    };
    spawn_all_item_boxes(boxes);

    ActorSpawnData palms[] = {
        { { gPalms[0][0], gPalms[0][1], gPalms[0][2] }, { 0 } },
        { { gPalms[1][0], gPalms[1][1], gPalms[1][2] }, { 1 } },
        { { gPalms[2][0], gPalms[2][1], gPalms[2][2] }, { 0 } },
        { { END_OF_SPAWN_DATA, 0, 0 }, { 0 } },
    };
    spawn_palm_trees(palms);
}

void KoopaBeachExtended::Draw(ScreenContext* screen) {
    KoopaTroopaBeach::Draw(screen);
    if (!gBuilt) {
        return;
    }
    gSPClearGeometryMode(gDisplayListHead++, G_LIGHTING);
    gSPSetGeometryMode(gDisplayListHead++, G_CULL_BACK | G_SHADING_SMOOTH);
    gDPSetCombineMode(gDisplayListHead++, G_CC_SHADE, G_CC_SHADE);
    gDPSetRenderMode(gDisplayListHead++, G_RM_AA_ZB_OPA_SURF, G_RM_AA_ZB_OPA_SURF2);
    draw_opaque(gRoad);
    draw_opaque(gRamp);
    draw_opaque(gRock);
}

void KoopaBeachExtended::DrawTransparency(ScreenContext* screen, uint16_t pathCounter, uint16_t cameraRot,
                                         uint16_t playerDirection) {
    KoopaTroopaBeach::DrawTransparency(screen, pathCounter, cameraRot, playerDirection);
    if (!gBuilt || gWater.overflow || (gWater.ng < 2)) {
        return;
    }
    gSPClearGeometryMode(gDisplayListHead++, G_CULL_BACK | G_LIGHTING);
    gDPSetRenderMode(gDisplayListHead++, G_RM_AA_ZB_XLU_INTER, G_RM_NOOP2);
    gDPSetCombineMode(gDisplayListHead++, G_CC_SHADE, G_CC_SHADE);
    gSPDisplayList(gDisplayListHead++, gWater.gfx);
    gSPSetGeometryMode(gDisplayListHead++, G_CULL_BACK);
}
