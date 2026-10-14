/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 16 апр. 2020 г.
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

#ifndef LSP_PLUG_IN_MM_TYPES_H_
#define LSP_PLUG_IN_MM_TYPES_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>

namespace lsp
{
    namespace mm
    {
        /**
         * Sample format
         */
        enum sformat_t
        {
            SFMT_NONE,
            SFMT_SHIFT_BITS = 2,

            SFMT_U8         = 1 << SFMT_SHIFT_BITS,
            SFMT_S8         = 2 << SFMT_SHIFT_BITS,
            SFMT_U16        = 3 << SFMT_SHIFT_BITS,
            SFMT_S16        = 4 << SFMT_SHIFT_BITS,
            SFMT_U24        = 5 << SFMT_SHIFT_BITS,
            SFMT_S24        = 6 << SFMT_SHIFT_BITS,
            SFMT_U32        = 7 << SFMT_SHIFT_BITS,
            SFMT_S32        = 8 << SFMT_SHIFT_BITS,
            SFMT_F32        = 9 << SFMT_SHIFT_BITS,
            SFMT_F64        = 10 << SFMT_SHIFT_BITS,

            SFMT_DFL        = 0,
            SFMT_LE         = 1,
            SFMT_BE         = 2,
            SFMT_EMASK      = 0x03,
            SFMT_CPU        = __IF_LEBE(SFMT_LE, SFMT_BE),

            // Shortened sample format definitions
            SFMT_U8_LE      = SFMT_U8 | SFMT_LE,
            SFMT_S8_LE      = SFMT_S8 | SFMT_LE,
            SFMT_U16_LE     = SFMT_U16 | SFMT_LE,
            SFMT_S16_LE     = SFMT_S16 | SFMT_LE,
            SFMT_U24_LE     = SFMT_U24 | SFMT_LE,
            SFMT_S24_LE     = SFMT_S24 | SFMT_LE,
            SFMT_U32_LE     = SFMT_U32 | SFMT_LE,
            SFMT_S32_LE     = SFMT_S32 | SFMT_LE,
            SFMT_F32_LE     = SFMT_F32 | SFMT_LE,
            SFMT_F64_LE     = SFMT_F64 | SFMT_LE,

            SFMT_U8_BE      = SFMT_U8 | SFMT_BE,
            SFMT_S8_BE      = SFMT_S8 | SFMT_BE,
            SFMT_U16_BE     = SFMT_U16 | SFMT_BE,
            SFMT_S16_BE     = SFMT_S16 | SFMT_BE,
            SFMT_U24_BE     = SFMT_U24 | SFMT_BE,
            SFMT_S24_BE     = SFMT_S24 | SFMT_BE,
            SFMT_U32_BE     = SFMT_U32 | SFMT_BE,
            SFMT_S32_BE     = SFMT_S32 | SFMT_BE,
            SFMT_F32_BE     = SFMT_F32 | SFMT_BE,
            SFMT_F64_BE     = SFMT_F64 | SFMT_BE,

            SFMT_U8_DFL     = SFMT_U8 | SFMT_DFL,
            SFMT_S8_DFL     = SFMT_S8 | SFMT_DFL,
            SFMT_U16_DFL    = SFMT_U16 | SFMT_DFL,
            SFMT_S16_DFL    = SFMT_S16 | SFMT_DFL,
            SFMT_U24_DFL    = SFMT_U24 | SFMT_DFL,
            SFMT_S24_DFL    = SFMT_S24 | SFMT_DFL,
            SFMT_U32_DFL    = SFMT_U32 | SFMT_DFL,
            SFMT_S32_DFL    = SFMT_S32 | SFMT_DFL,
            SFMT_F32_DFL    = SFMT_F32 | SFMT_DFL,
            SFMT_F64_DFL    = SFMT_F64 | SFMT_DFL,

            SFMT_U8_CPU     = SFMT_U8 | SFMT_CPU,
            SFMT_S8_CPU     = SFMT_S8 | SFMT_CPU,
            SFMT_U16_CPU    = SFMT_U16 | SFMT_CPU,
            SFMT_S16_CPU    = SFMT_S16 | SFMT_CPU,
            SFMT_U24_CPU    = SFMT_U24 | SFMT_CPU,
            SFMT_S24_CPU    = SFMT_S24 | SFMT_CPU,
            SFMT_U32_CPU    = SFMT_U32 | SFMT_CPU,
            SFMT_S32_CPU    = SFMT_S32 | SFMT_CPU,
            SFMT_F32_CPU    = SFMT_F32 | SFMT_CPU,
            SFMT_F64_CPU    = SFMT_F64 | SFMT_CPU
        };

        /**
         * Audio format
         */
        enum aformat_t
        {
            // Audio file formats
            AFMT_WAV        = 0x010000,     /* Microsoft WAV format (little endian default). */
            AFMT_AIFF       = 0x020000,     /* Apple/SGI AIFF format (big endian). */
            AFMT_AU         = 0x030000,     /* Sun/NeXT AU format (big endian). */
            AFMT_RAW        = 0x040000,     /* RAW PCM data. */
            AFMT_PAF        = 0x050000,     /* Ensoniq PARIS file format. */
            AFMT_SVX        = 0x060000,     /* Amiga IFF / SVX8 / SV16 format. */
            AFMT_NIST       = 0x070000,     /* Sphere NIST format. */
            AFMT_VOC        = 0x080000,     /* VOC files. */
            AFMT_IRCAM      = 0x0A0000,     /* Berkeley/IRCAM/CARL */
            AFMT_W64        = 0x0B0000,     /* Sonic Foundry's 64 bit RIFF/WAV */
            AFMT_MAT4       = 0x0C0000,     /* Matlab (tm) V4.2 / GNU Octave 2.0 */
            AFMT_MAT5       = 0x0D0000,     /* Matlab (tm) V5.0 / GNU Octave 2.1 */
            AFMT_PVF        = 0x0E0000,     /* Portable Voice Format */
            AFMT_XI         = 0x0F0000,     /* Fasttracker 2 Extended Instrument */
            AFMT_HTK        = 0x100000,     /* HMM Tool Kit format */
            AFMT_SDS        = 0x110000,     /* Midi Sample Dump Standard */
            AFMT_AVR        = 0x120000,     /* Audio Visual Research */
            AFMT_WAVEX      = 0x130000,     /* MS WAVE with WAVEFORMATEX */
            AFMT_SD2        = 0x160000,     /* Sound Designer 2 */
            AFMT_FLAC       = 0x170000,     /* FLAC lossless file format */
            AFMT_CAF        = 0x180000,     /* Core Audio File format */
            AFMT_WVE        = 0x190000,     /* Psion WVE format */
            AFMT_OGG        = 0x200000,     /* Xiph OGG container */
            AFMT_MPC2K      = 0x210000,     /* Akai MPC 2000 sampler */
            AFMT_RF64       = 0x220000,     /* RF64 WAV file */

            // Audio codecs
            CFMT_PCM        = 0x0001,       /* Signed 8 bit data */

            CFMT_ULAW       = 0x0002,       /* U-Law encoded. */
            CFMT_ALAW       = 0x0003,       /* A-Law encoded. */
            CFMT_IMA_ADPCM  = 0x0004,       /* IMA ADPCM. */
            CFMT_MS_ADPCM   = 0x0005,       /* Microsoft ADPCM. */

            CFMT_GSM610     = 0x0006,       /* GSM 6.10 encoding. */
            CFMT_VOX_ADPCM  = 0x0007,       /* OKI / Dialogix ADPCM */

            CFMT_G721_32    = 0x0008,       /* 32kbs G721 ADPCM encoding. */
            CFMT_G723_24    = 0x0009,       /* 24kbs G723 ADPCM encoding. */
            CFMT_G723_40    = 0x000a,       /* 40kbs G723 ADPCM encoding. */

            CFMT_DWVW_12    = 0x000b,       /* 12 bit Delta Width Variable Word encoding. */
            CFMT_DWVW_16    = 0x000c,       /* 16 bit Delta Width Variable Word encoding. */
            CFMT_DWVW_24    = 0x000d,       /* 24 bit Delta Width Variable Word encoding. */
            CFMT_DWVW_N     = 0x000e,       /* N bit Delta Width Variable Word encoding. */

            CFMT_DPCM_8     = 0x000f,       /* 8 bit differential PCM (XI only) */
            CFMT_DPCM_16    = 0x0010,       /* 16 bit differential PCM (XI only) */

            CFMT_VORBIS     = 0x0011,       /* Xiph Vorbis encoding. */

            CFMT_ALAC_16    = 0x0012,       /* Apple Lossless Audio Codec (16 bit). */
            CFMT_ALAC_20    = 0x0013,       /* Apple Lossless Audio Codec (20 bit). */
            CFMT_ALAC_24    = 0x0014,       /* Apple Lossless Audio Codec (24 bit). */
            CFMT_ALAC_32    = 0x0015,       /* Apple Lossless Audio Codec (32 bit). */

            AFMT_MASK       = 0xffff0000,
            CFMT_MASK       = 0x0000ffff
        };

        typedef float       f32_t;
        typedef double      f64_t;

        typedef struct audio_stream_t
        {
            size_t      srate;          // Sample rate
            size_t      channels;       // Number of channels
            wssize_t    frames;         // Number of frames
            size_t      format;         // Sample format
        } audio_stream_t;

        inline size_t   sformat_endian(size_t fmt)        { return fmt & SFMT_EMASK;        }
        inline size_t   sformat_format(size_t fmt)        { return fmt & (~SFMT_EMASK);     }
        int             sformat_sign(size_t fmt);
        ssize_t         sformat_signed(size_t fmt);
        ssize_t         sformat_unsigned(size_t fmt);
        size_t          sformat_size_of(size_t fmt);

        typedef         void (*user_data_deleter_t)(void *data);

    } /* namespace mm */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_MM_TYPES_H_ */
