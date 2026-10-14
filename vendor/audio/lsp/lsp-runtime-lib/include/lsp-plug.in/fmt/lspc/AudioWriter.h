/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 6 нояб. 2018 г.
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

#ifndef LSP_PLUG_IN_FMT_LSPC_AUDIOWRITER_H_
#define LSP_PLUG_IN_FMT_LSPC_AUDIOWRITER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/runtime/LSPString.h>
#include <lsp-plug.in/common/types.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/fmt/lspc/File.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/fmt/lspc/lspc.h>

namespace lsp
{
    namespace lspc
    {
        /**
         * This is helper class for writing audio content to LSPC files.
         */
        class AudioWriter
        {
            private:
                enum flags_t
                {
                    F_OPENED            = 1 << 0,
                    F_CLOSE_WRITER      = 1 << 1,
                    F_CLOSE_FILE        = 1 << 2,
                    F_REV_BYTES         = 1 << 3,
                    F_DROP_WRITER       = 1 << 4,
                    F_INTEGER_SAMPLE    = 1 << 5,
                    F_DROP_FILE         = 1 << 6
                };

                typedef void (* encode_func_t)(void *dst, const float *src, size_t ns);

            protected:
                audio_parameters_t          sParams;
                File                       *pFD;
                ChunkWriter                *pWD;
                size_t                      nFlags;
                size_t                      nBPS;           // Bytes per sample
                size_t                      nFrameChannels; // Size of frame in channels
                encode_func_t               pEncode;
                float                      *pBuffer;
                uint8_t                    *pFBuffer;       // frame buffer

            protected:
                static void     encode_u8(void *vp, const float *src, size_t ns);
                static void     encode_s8(void *vp, const float *src, size_t ns);
                static void     encode_u16(void *vp, const float *src, size_t ns);
                static void     encode_s16(void *vp, const float *src, size_t ns);
                static void     encode_u24le(void *vp, const float *src, size_t ns);
                static void     encode_u24be(void *vp, const float *src, size_t ns);
                static void     encode_s24le(void *vp, const float *src, size_t ns);
                static void     encode_s24be(void *vp, const float *src, size_t ns);
                static void     encode_u32(void *vp, const float *src, size_t ns);
                static void     encode_s32(void *vp, const float *src, size_t ns);
                static void     encode_f32(void *vp, const float *src, size_t ns);
                static void     encode_f64(void *vp, const float *src, size_t ns);

            protected:
                status_t parse_parameters(const audio_parameters_t *p);
                status_t free_resources();
                status_t write_header(ChunkWriter *wr);

            public:
                explicit AudioWriter();
                AudioWriter(const AudioWriter &) = delete;
                AudioWriter(AudioWriter &&) = delete;
                ~AudioWriter();

                AudioWriter & operator = (const AudioWriter &) = delete;
                AudioWriter & operator = (AudioWriter &&) = delete;

            public:
                /**
                 * Create new LSPC file and open for writing, write header to LSPC file
                 * @param path UTF-8 path to the LSPC file
                 * @param params audio parameters
                 * @return status of operation
                 */
                status_t create(const char *path, const audio_parameters_t *params);

                /**
                 * Create new LSPC file and open for writing, write header to LSPC file
                 * @param path path to the LSPC file
                 * @param params audio parameters
                 * @return status of operation
                 */
                status_t create(const LSPString *path, const audio_parameters_t *params);

                /**
                 * Create new LSPC file and open for writing, write header to LSPC file
                 * @param path path to the LSPC file
                 * @param params audio parameters
                 * @return status of operation
                 */
                status_t create(const io::Path *path, const audio_parameters_t *params);

                /**
                 * Create chunk in LSPC file with magic=LSPC_CHUNK_AUDIO and write header
                 * @param lspc LSPC file
                 * @param params audio stream parameters
                 * @param auto_close automatically close file on close()
                 * @return status of operation
                 */
                status_t open(File *lspc, const audio_parameters_t *params, bool auto_close = false);

                /**
                 * Create chunk in LSPC file with magic=LSPC_CHUNK_AUDIO, do not write header
                 * @param lspc LSPC file
                 * @param params audio stream parameters
                 * @param auto_close automatically close file on close()
                 * @return status of operation
                 */
                status_t open_raw(File *lspc, const audio_parameters_t *params, bool auto_close = false);

                /**
                 * Create chunk in LSPC file with specified magic and write header
                 * @param lspc LSPC file
                 * @param magic specified chunk magic
                 * @param params audio stream parameters
                 * @param auto_close automatically close file on close()
                 * @return status of operation
                 */
                status_t open(File *lspc, uint32_t magic, const audio_parameters_t *params, bool auto_close = false);

                /**
                 * Create chunk in LSPC file with specified magic, do not write header
                 * @param lspc LSPC file
                 * @param magic specified chunk magic
                 * @param params audio stream parameters
                 * @param auto_close automatically close file on close()
                 * @return status of operation
                 */
                status_t open_raw(File *lspc, uint32_t magic, const audio_parameters_t *params, bool auto_close = false);

                /**
                 * Write header to already opened chunk
                 * @param wr chunk writer
                 * @param params audio stream parameters
                 * @param auto_close automatically close chunk writer on close()
                 * @return status of operation
                 */
                status_t open(ChunkWriter *wr, const audio_parameters_t *params, bool auto_close = false);

                /**
                 * Open chunk writer as a raw data stream. Does not emit audio header into stream contents.
                 * @param wr chunk writer
                 * @param params audio stream parameters
                 * @param auto_close automatically close chunk writer on close()
                 * @return status of operation
                 */
                status_t open_raw(ChunkWriter *wr, const audio_parameters_t *params, bool auto_close = false);

                /**
                 * Close audio writer
                 * @return status of operation
                 */
                status_t close();

                /**
                 * Write sample data to chunk
                 *
                 * @param data array of pointers to store data, must match number of channels in the stream
                 * @param frames number of frames to write
                 * @return status of operation
                 */
                status_t write_samples(const float **data, size_t frames);

                /**
                 * Write frames to chunk
                 * @param data buffer to store data
                 * @param frames number of frames to write
                 * @return status of operation
                 */
                status_t write_frames(const float *data, size_t frames);

                /**
                 * Obtain current audio parameters of the stream
                 * @param dst pointer to store audio parameters
                 * @return status of operation
                 */
                status_t get_parameters(audio_parameters_t *dst) const;

                /**
                 * Get current chunk identifier
                 * @return current chunk identifier
                 */
                uint32_t unique_id() const;

                /**
                 * Get current chunk magic
                 * @return current chunk magic
                 */
                uint32_t magic() const;
        };
    }

} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_LSPC_AUDIOWRITER_H_ */
