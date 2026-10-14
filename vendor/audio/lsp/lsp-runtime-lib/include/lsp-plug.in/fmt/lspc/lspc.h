/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 14 янв. 2018 г.
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

#ifndef LSP_PLUG_IN_FMT_LSPC_LSPC_H_
#define LSP_PLUG_IN_FMT_LSPC_LSPC_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/types.h>

namespace lsp
{
    namespace lspc
    {
        /** @note All data is stored in big-endian format!
         * Common file structure:
         *
         *      1. Header
         *      2. Chunk
         *      3. Chunk
         *      4. Chunk
         *      ...
         *      N. Chunk
         *
         *  Each chunk represents the potion of the stream and has the following structure:
         *      1. Chunk header
         *      2. Payload
         *
         *  Each chunk header identifies the type of chunk and unique identifier of the stream
         *  associated with the chunk. Additionally, it holds size of payload data and flags
         *  like the indicator of last chunk in the stream.
         */

    #pragma pack(push, 1)
        typedef uint32_t chunk_magic_t;     // Chunk magic (type) code
        typedef uint32_t chunk_id_t;        // Chunk identifier

        typedef struct root_header_t
        {
            uint32_t        magic;          // Magic number, should be LSPC_ROOT_MAGIC
            uint16_t        version;        // Header version
            uint16_t        size;           // Size of header
            uint32_t        reserved[4];    // Some reserved data
        } root_header_t;

        typedef struct chunk_header_t
        {
            uint32_t        magic;          // Chunk type, should be identical for each chunk
            uint32_t        uid;            // Unique chunk identifier within file
            uint32_t        flags;          // Chunk flags
            uint32_t        size;           // The size of chunk data after header
        } chunk_header_t;

        typedef struct header_t
        {
            uint32_t        size;           // Size of header
            uint16_t        version;        // Version of header
        } header_t;

        typedef struct lspc_chunk_raw_header_t
        {
            header_t        common;         // Common header data
            uint8_t         data[];         // header contents
        } chunk_raw_header_t;

        typedef struct chunk_audio_header_t // Magic number: LSPC_CHUNK_AUDIO
        {
            header_t        common;         // Common header data
            uint8_t         channels;       // Number of channels
            uint8_t         sample_format;  // Sample format (see lspc_sample_format_t)
            uint32_t        sample_rate;    // Sample rate
            uint32_t        codec;          // Codec used (see lspc_codec_t)
            uint64_t        frames;         // Overall number of frames in file
            int64_t 		offset; 		// Offset with which to load the frames (since header v.1, deprecated since header v.2)
            uint32_t        reserved[4];    // Some reserved data
        } chunk_audio_header_t;

        typedef struct chunk_audio_profile_t // Magic number: LSPC_CHUNK_PROFILE
        {
            header_t        common;         // Common header data
            uint16_t        pad;            // Padding (reserved), should be zero
            chunk_id_t      chunk_id;       // Chunk identifier related to the audio profile
            uint32_t        chirp_order;    // Chirp order
            float           alpha;          // The chirp parameter alpha, a float value
            double          beta;           // The chirp parameter beta, a double value
            double          gamma;          // The chirp parameter gamma, a double value
            double          delta;          // The chirp parameter delta, a double value
            double          initial_freq;   // The chirp initial frequency
            double          final_freq;     // The chirp final frequency
            int64_t         skip;           // Frame to skip for linear response loading (since header v.2)
            uint32_t        reserved[6];    // Some reserved data for future use
        } chunk_audio_profile_t;

        typedef struct chunk_text_config_t  // Magic number: LSPC_CHUNK_TEXT_CONFIG
        {
            header_t        common;         // Common header data
            uint16_t        pad;            // Padding (reserved), should be zero
        } chunk_text_config_t;

        typedef struct chunk_path_t         // Magic number: LSPC_CHUNK_PATH
        {
            header_t        common;         // Common header data
            uint16_t        path_size;      // Size of the path string in bytes
            uint32_t        flags;          // Path flags (see path_flags_t)
            chunk_id_t      chunk_id;       // Identifier of the related chunk that contains the data
        } chunk_path_t;

        typedef struct chunk_plain_data_t   // Magic number: LSPC_CHUNK_PLAIN_DATA
        {
            header_t        common;         // Common header data
            uint16_t        pad;            // Padding (reserved), should be zero
        } chunk_plain_data_t;

    #pragma pack(pop)

        // Different chunk types
        #define LSPC_ROOT_MAGIC             0x4C535043      /* 'LSPC' - magic number for the root LSPC header           */
        #define LSPC_CHUNK_AUDIO            0x41554449      /* 'AUDI' - magic number for the audio data chunk           */
        #define LSPC_CHUNK_PROFILE          0x50524F46      /* 'PROF' - magic number for the profile data chunk         */
        #define LSPC_CHUNK_TEXT_CONFIG      0x54434647      /* 'TCFG' - magic number for the text configuration file    */
        #define LSPC_CHUNK_PATH             0x50415448      /* 'PATH' - magic number for the file descriptor            */
        #define LSPC_CHUNK_PLAIN_DATA       0x44415441      /* 'DATA' - magic number for some plain data                */

        // Chunk flags
        #define LSPC_CHUNK_FLAG_LAST        (1 << 0)

        // Different kinds of sample format
        enum lspc_sample_format_t
        {
            SAMPLE_FMT_U8LE         = 0x00,
            SAMPLE_FMT_U8BE         = 0x01,
            SAMPLE_FMT_S8LE         = 0x02,
            SAMPLE_FMT_S8BE         = 0x03,
            SAMPLE_FMT_U16LE        = 0x04,
            SAMPLE_FMT_U16BE        = 0x05,
            SAMPLE_FMT_S16LE        = 0x06,
            SAMPLE_FMT_S16BE        = 0x07,
            SAMPLE_FMT_U24LE        = 0x08,
            SAMPLE_FMT_U24BE        = 0x09,
            SAMPLE_FMT_S24LE        = 0x0a,
            SAMPLE_FMT_S24BE        = 0x0b,
            SAMPLE_FMT_U32LE        = 0x0c,
            SAMPLE_FMT_U32BE        = 0x0d,
            SAMPLE_FMT_S32LE        = 0x0e,
            SAMPLE_FMT_S32BE        = 0x0f,
            SAMPLE_FMT_F32LE        = 0x10,
            SAMPLE_FMT_F32BE        = 0x11,
            SAMPLE_FMT_F64LE        = 0x12,
            SAMPLE_FMT_F64BE        = 0x13
        };

        #define LSPC_SAMPLE_FMT_IS_LE(x)    (!(x & 1))
        #define LSPC_SAMPLE_FMT_IS_BE(x)    (x & 1)
        #ifdef ARCH_LE /* Little-endian architecture */
            #define LSPC_SAMPLE_FMT_NEED_REVERSE(x)         LSPC_SAMPLE_FMT_IS_BE(x)
        #else /* Big-endian architecture */
            #define LSPC_SAMPLE_FMT_NEED_REVERSE(x)         LSPC_SAMPLE_FMT_IS_LE(x)
        #endif /* ARCH_LE */

        // Different codec types
        enum lspc_codec_t
        {
            CODEC_PCM               = 0         // PCM data
        };

        // Different path flags
        enum path_flags_t
        {
            PATH_DIR                = 1 << 0    // Pathname is a directory
        };

        typedef struct chunk_info_t
        {
            uint32_t        magic;          // Chunk magic number
            chunk_id_t      chunk_id;       // Chunk identifier
            wsize_t         position;       // Chunk position in the file
            wsize_t         size;           // Overall size of the payload in the chunk
        } chunk_info_t;

        typedef struct audio_parameters_t
        {
            size_t          channels;       // Number of channels
            size_t          sample_format;  // Sample format
            size_t          sample_rate;    // Sample rate
            size_t          codec;          // Codec used
            wsize_t         frames;         // Overall number of frames in file
        } audio_parameters_t;

        typedef struct audio_format_t
        {
            size_t          sample_format;  // Sample format
            size_t          sample_rate;    // Sample rate
            size_t          codec;          // Codec used
        } audio_format_t;

        typedef struct path_entry_t
        {
            char           *path;           // Path entry
            uint32_t        flags;          // Path flag
            chunk_id_t      chunk_id;       // Referenced chunk identifier
        } path_entry_t;

    } /* namespace lspc */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_LSPC_LSPC_H_ */
