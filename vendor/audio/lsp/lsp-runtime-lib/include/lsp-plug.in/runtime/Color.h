/*
 * Copyright (C) 2026 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2026 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 05 нояб. 2015 г.
 *
 * lsp-runtime-lib is free software: you can redistribute it and/or modify
 * it under the terms of the GNU Lesser General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * any later version.
 *
 * lsp-runtime-lib is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU Lesser General Public License for more details.
 *
 * You should have received a copy of the GNU Lesser General Public License
 * along with lsp-runtime-lib. If not, see <https://www.gnu.org/licenses/>.
 */

#ifndef LSP_PLUG_IN_RUNTIME_COLOR_H_
#define LSP_PLUG_IN_RUNTIME_COLOR_H_

#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/runtime/LSPString.h>

namespace lsp
{
    /**
     * Color class. Represents an object that allows to work with different color models.
     * Supported color models:
     *   - RGB (red, green, blue components)
     *   - HSL (hue, saturation, lightness components)
     *   - Alpha channel
     * All components are normalzed within the [0.0f .. 1.0f] range
     */
    class Color
    {
        protected:
            enum mask_t
            {
                M_RGB           = 1 << 0,   // Standard RGB color components
                M_HSL           = 1 << 1,   // Hue/Saturation/Lightness components
                M_XYZ           = 1 << 2,   // CIE XYZ components
                M_LAB           = 1 << 3,   // CIE LAB D65 standard components
                M_LCH           = 1 << 4,   // CIE LCH D65 standard components
                M_CMYK          = 1 << 5,   // CMYK color space
            };

            typedef struct rgb_t
            {
                float   R, G, B;
            } rgb_t;

            typedef struct hsl_t
            {
                float   H, S, L;
            } hsl_t;

            typedef struct xyz_t
            {
                float   X, Y, Z;
            } xyz_t;

            typedef struct lab_t
            {
                float   L, A, B;
            } lab_t;

            typedef struct lch_t
            {
                float   L, C, H;
            } lch_t;

            typedef struct cmyk_t
            {
                float   C, M, Y, K;
            } cmyk_t;

        protected:
            mutable rgb_t   rgb;
            mutable hsl_t   hsl;
            mutable xyz_t   xyz;
            mutable lab_t   lab;
            mutable lch_t   lch;
            mutable cmyk_t  cmyk;
            mutable size_t  mask;
            mutable float   A;

            rgb_t          &calc_rgb() const noexcept;
            hsl_t          &calc_hsl() const noexcept;
            xyz_t          &calc_xyz() const noexcept;
            lab_t          &calc_lab() const noexcept;
            lch_t          &calc_lch() const noexcept;
            cmyk_t         &calc_cmyk() const noexcept;

            bool            hsl_to_rgb() const noexcept;
            bool            xyz_to_rgb() const noexcept;
            bool            lab_to_xyz() const noexcept;
            bool            lch_to_lab() const noexcept;
            bool            cmyk_to_rgb() const noexcept;

        protected:
            static status_t     parse_hex(float *dst, size_t n, char prefix, const char *src, size_t len) noexcept;
            static status_t     parse_numeric(float *dst, size_t nmin, size_t nmax, const char *prefix, const char *src, size_t len) noexcept;
            static status_t     parse_cnumeric(float *dst, size_t nmin, size_t nmax, const char *prefix, const char *src, size_t len) noexcept;
            static ssize_t      format(char *dst, size_t len, size_t tolerance, const float *v, char prefix, bool alpha) noexcept;
            static inline float clamp(float x) noexcept;

        // Construction and destruction
        public:
            Color() noexcept;
            explicit Color(const Color &src) noexcept;
            explicit Color(const Color *src) noexcept;
            Color(Color &&src) noexcept;
            explicit Color(uint32_t rgb) noexcept;

            Color(float r, float g, float b) noexcept;
            Color(float r, float g, float b, float a) noexcept;
            Color(const Color &src, float a) noexcept;
            Color(const Color *src, float a) noexcept;
            Color(uint32_t rgb, float a) noexcept;

            Color &operator = (const Color & src) noexcept;
            Color &operator = (Color && src) noexcept;

        // Copying and swapping
        public:
            Color          &copy(const Color &c) noexcept;
            Color          &copy(const Color *c) noexcept;
            Color          &copy(const Color &c, float a) noexcept;
            Color          &copy(const Color *c, float a) noexcept;
            void            swap(Color *src) noexcept;
            inline void     swap(Color &src) noexcept           { swap(&src);               }

        // RGB-related functions
        public:
            // Check that RGB data is currently present without need of implicit conversion
            inline bool     is_rgb() const noexcept             { return mask & M_RGB;      }

            // Get color components
            inline float    red() const noexcept                { return calc_rgb().R;      }
            inline float    green() const noexcept              { return calc_rgb().G;      }
            inline float    blue() const noexcept               { return calc_rgb().B;      }

            const Color    &get_rgb(float &r, float &g, float &b) const noexcept;
            Color          &get_rgb(float &r, float &g, float &b) noexcept;
            const Color    &get_rgba(float &r, float &g, float &b, float &a) const noexcept;
            const Color    &get_rgbo(float &r, float &g, float &b, float &o) const noexcept;
            Color          &get_rgba(float &r, float &g, float &b, float &a) noexcept;

            uint32_t        rgb24() const noexcept;

            /**
             * Get RGBA color where fully transparent alpha is 0xff and fully
             * opaque alpha is 0xff.
             * @return RGBA32 color in format 0xAARRGGBB
             */
            uint32_t        rgba32() const noexcept;

            /**
             * Get device RGBA color where fully transparent alpha is 0
             * and fully opaqe alpha is 0xff.
             * @return RGBA32 color in device format 0xAARRGGBB
             */
            uint32_t        dev_rgba32() const noexcept;

            /**
             * Get pre-multiplied RGBA color where fully transparent alpha is 0
             * and fully opaqe alpha is 0xff.
             * @return premultiplied RGBA32 color in format 0xAARRGGBB
             */
            uint32_t        prgba32() const noexcept;

            // Update color components
            Color          &red(float r) noexcept;
            Color          &green(float g) noexcept;
            Color          &blue(float b) noexcept;

            Color          &set_rgb(float r, float g, float b) noexcept;
            Color          &set_rgba(float r, float g, float b, float a) noexcept;

            Color          &set_rgb24(uint32_t v) noexcept;
            Color          &set_rgba32(uint32_t v) noexcept;
            Color          &set_prgba32(uint32_t v) noexcept;
            Color          &set_dev_rgba32(uint32_t v) noexcept;

            // Formatting
            ssize_t         format_rgb(char *dst, size_t len, size_t tolerance = 2) const noexcept;
            ssize_t         format_rgb(LSPString *dst, size_t tolerance = 2) const noexcept;
            ssize_t         format_rgba(char *dst, size_t len, size_t tolerance = 2) const noexcept;
            ssize_t         format_rgba(LSPString *dst, size_t tolerance = 2) const noexcept;

            // Parsing
            status_t        parse_rgb(const char *src, size_t len) noexcept;
            status_t        parse_rgb(const char *src) noexcept;
            status_t        parse_rgb(const LSPString *src, size_t len) noexcept    { return parse_rgb(src->get_utf8(0, len));      }
            status_t        parse_rgb(const LSPString *src) noexcept                { return parse_rgb(src->get_utf8());            }

            status_t        parse_rgba(const char *src, size_t len) noexcept;
            status_t        parse_rgba(const char *src) noexcept;
            status_t        parse_rgba(const LSPString *src, size_t len) noexcept   { return parse_rgba(src->get_utf8(0, len));     }
            status_t        parse_rgba(const LSPString *src) noexcept               { return parse_rgba(src->get_utf8());           }

        // HSL-related functions
        public:
            // Check that HSL data is currently present without need of implicit conversion
            inline bool     is_hsl() const noexcept             { return mask & M_HSL;      }

            // Get color components
            inline float    hue() const noexcept                { return calc_hsl().H;      }
            inline float    saturation() const noexcept         { return calc_hsl().S;      }
            inline float    lightness() const noexcept          { return calc_hsl().L;      }
            inline float    hsl_hue() const noexcept            { return calc_hsl().H;      }
            inline float    hsl_saturation() const noexcept     { return calc_hsl().S;      }
            inline float    hsl_lightness() const noexcept      { return calc_hsl().L;      }

            const Color    &get_hsl(float &h, float &s, float &l) const noexcept;
            Color          &get_hsl(float &h, float &s, float &l) noexcept;
            const Color    &get_hsla(float &h, float &s, float &l, float &a) const noexcept;
            Color          &get_hsla(float &h, float &s, float &l, float &a) noexcept;

            uint32_t        hsl24() const noexcept;
            uint32_t        hsla32() const noexcept;

            // Update color components
            Color          &hue(float h) noexcept;
            Color          &saturation(float s) noexcept;
            Color          &lightness(float l) noexcept;
            Color          &hsl_hue(float h) noexcept;
            Color          &hsl_saturation(float s) noexcept;
            Color          &hsl_lightness(float l) noexcept;

            Color          &set_hsl(float h, float s, float l) noexcept;
            Color          &set_hsla(float h, float s, float l, float a) noexcept;

            Color          &set_hsl24(uint32_t v) noexcept;
            Color          &set_hsla32(uint32_t v) noexcept;

            // Formatting
            ssize_t         format_hsl(char *dst, size_t len, size_t tolerance = 2) const noexcept;
            ssize_t         format_hsl(LSPString *dst, size_t tolerance = 2) const noexcept;
            ssize_t         format_hsla(char *dst, size_t len, size_t tolerance = 2) const noexcept;
            ssize_t         format_hsla(LSPString *dst, size_t tolerance = 2) const noexcept;

            // Parsing
            status_t        parse_hsl(const char *src, size_t len) noexcept;
            status_t        parse_hsl(const char *src) noexcept;
            status_t        parse_hsl(const LSPString *src, size_t len) noexcept    { return parse_hsl(src->get_utf8(0, len));      }
            status_t        parse_hsl(const LSPString *src) noexcept                { return parse_hsl(src->get_utf8());            }

            status_t        parse_hsla(const char *src, size_t len) noexcept;
            status_t        parse_hsla(const char *src) noexcept;
            status_t        parse_hsla(const LSPString *src, size_t len) noexcept   { return parse_hsla(src->get_utf8(0, len));     }
            status_t        parse_hsla(const LSPString *src) noexcept               { return parse_hsla(src->get_utf8());           }

        // CIE XYZ-related functions (D65 standard)
        public:
            // Check that XYZ data is currently present without need of implicit conversion
            inline bool     is_xyz() const noexcept             { return mask & M_XYZ;      }

            // Get color components
            inline float    xyz_x() const noexcept              { return calc_xyz().X;      }
            inline float    xyz_y() const noexcept              { return calc_xyz().Y;      }
            inline float    xyz_z() const noexcept              { return calc_xyz().Z;      }

            const Color    &get_xyz(float &x, float &y, float &z) const noexcept;
            Color          &get_xyz(float &x, float &y, float &z) noexcept;
            const Color    &get_xyza(float &x, float &y, float &z, float &a) const noexcept;
            Color          &get_xyza(float &x, float &y, float &z, float &a) noexcept;

            // Update color components
            Color          &xyz_x(float x) noexcept;
            Color          &xyz_y(float y) noexcept;
            Color          &xyz_z(float z) noexcept;

            Color          &set_xyz(float x, float y, float z) noexcept;
            Color          &set_xyza(float x, float y, float z, float a) noexcept;

        // CIE LAB-related functions (D65 standard)
        public:
            // Check that LAB data is currently present without need of implicit conversion
            inline bool     is_lab() const noexcept             { return mask & M_LAB;      }

            // Get color components
            inline float    lab_l() const noexcept              { return calc_lab().L;      }
            inline float    lab_a() const noexcept              { return calc_lab().A;      }
            inline float    lab_b() const noexcept              { return calc_lab().B;      }

            const Color    &get_lab(float &l, float &a, float &b) const noexcept;
            Color          &get_lab(float &l, float &a, float &b) noexcept;
            const Color    &get_laba(float &l, float &a, float &b, float &alpha) const noexcept;
            Color          &get_laba(float &l, float &a, float &b, float &alpha) noexcept;

            // Update color components
            Color          &lab_l(float l) noexcept;
            Color          &lab_a(float a) noexcept;
            Color          &lab_b(float b) noexcept;

            Color          &set_lab(float l, float a, float b) noexcept;
            Color          &set_laba(float l, float a, float b, float alpha) noexcept;

        // CIE LCH-related functions (D65 standard)
        public:
            // Check that LCH data is currently present without need of implicit conversion
            inline bool     is_lch() const noexcept             { return mask & M_LCH;      }
            inline bool     is_hcl() const noexcept             { return mask & M_LCH;      }

            // Get color components
            inline float    lch_l() const noexcept              { return calc_lch().L;      }
            inline float    lch_c() const noexcept              { return calc_lch().C;      }
            inline float    lch_h() const noexcept              { return calc_lch().H;      }
            inline float    hcl_l() const noexcept              { return calc_lch().L;      }
            inline float    hcl_c() const noexcept              { return calc_lch().C;      }
            inline float    hcl_h() const noexcept              { return calc_lch().H;      }

            const Color    &get_lch(float &l, float &c, float &h) const noexcept;
            Color          &get_lch(float &l, float &c, float &h) noexcept;
            const Color    &get_lcha(float &l, float &c, float &h, float &alpha) const noexcept;
            Color          &get_lcha(float &l, float &c, float &h, float &alpha) noexcept;
            const Color    &get_hcl(float &h, float &c, float &l) const noexcept;
            Color          &get_hcl(float &h, float &c, float &l) noexcept;
            const Color    &get_hcla(float &h, float &c, float &l, float &alpha) const noexcept;
            Color          &get_hcla(float &h, float &c, float &l, float &alpha) noexcept;

            // Update color components
            Color          &lch_l(float l) noexcept;
            Color          &lch_c(float c) noexcept;
            Color          &lch_h(float h) noexcept;
            Color          &hcl_l(float l) noexcept;
            Color          &hcl_c(float c) noexcept;
            Color          &hcl_h(float h) noexcept;

            Color          &set_lch(float l, float c, float h) noexcept;
            Color          &set_lcha(float l, float c, float h, float alpha) noexcept;
            Color          &set_hcl(float h, float c, float l) noexcept;
            Color          &set_hcla(float h, float c, float l, float alpha) noexcept;

        // CMYK color space
        public:
            inline bool     is_cmyk() const noexcept            { return mask & M_CMYK;     }
            inline float    cyan() const noexcept               { return calc_cmyk().C;     }
            inline float    magenta() const noexcept            { return calc_cmyk().M;     }
            inline float    yellow() const noexcept             { return calc_cmyk().Y;     }
            inline float    black() const noexcept              { return calc_cmyk().K;     }

            const Color    &get_cmyk(float &c, float &m, float &y, float &k) const noexcept;
            Color          &get_cmyk(float &c, float &m, float &y, float &k) noexcept;
            const Color    &get_cmyka(float &c, float &m, float &y, float &k, float &alpha) const noexcept;
            Color          &get_cmyka(float &c, float &m, float &y, float &k, float &alpha) noexcept;

            // Update color components
            Color          &cyan(float c) noexcept;
            Color          &magenta(float m) noexcept;
            Color          &yellow(float y) noexcept;
            Color          &black(float k) noexcept;

            Color          &set_cmyk(float c, float m, float y, float k) noexcept;
            Color          &set_cmyka(float c, float m, float y, float k, float alpha) noexcept;

        // Alpha-blending channel
        public:
            inline float    alpha() const noexcept              { return A;                 }
            inline float    opacity() const noexcept            { return 1.0f - A;          }
            inline float    dev_alpha() const noexcept          { return 1.0f - A;          }
            Color          &alpha(float a) noexcept;
            Color          &opacity(float o) noexcept;

        // Parsing
        public:
            // Parsing raw data
            status_t        parse3(const char *src, size_t len) noexcept;
            status_t        parse3(const char *src) noexcept;
            status_t        parse4(const char *src, size_t len) noexcept;
            status_t        parse4(const char *src) noexcept;
            status_t        parse(const char *src, size_t len) noexcept;
            status_t        parse(const char *src) noexcept;

            // Parsing LSPString
            inline status_t parse3(const LSPString *src, size_t len) noexcept       { return parse3(src->get_utf8(0, len));         }
            inline status_t parse3(const LSPString *src) noexcept                   { return parse3(src->get_utf8());               }
            inline status_t parse4(const LSPString *src, size_t len) noexcept       { return parse4(src->get_utf8(0, len));         }
            inline status_t parse4(const LSPString *src) noexcept                   { return parse4(src->get_utf8());               }

            // Formatting data
            ssize_t         format3(char *dst, size_t len) const noexcept;
            ssize_t         format3(LSPString *dst) const noexcept;
            ssize_t         format4(char *dst, size_t len) const noexcept;
            ssize_t         format4(LSPString *dst) const noexcept;

        // Miscellaneous effects
        public:
            Color          &blend(const Color &c, float alpha) noexcept;
            Color          &blend(float r, float g, float b, float alpha) noexcept;
            Color          &darken(float amount) noexcept;
            Color          &lighten(float amount) noexcept;
            Color          &blend(const Color &c1, const Color &c2, float alpha) noexcept;
            void            scale_hsl_lightness(float amount) noexcept;
            void            scale_lch_luminance(float amount) noexcept;
    };

} /* namespace lsp */

#endif /* LSP_PLUG_IN_RUNTIME_COLOR_H_ */
