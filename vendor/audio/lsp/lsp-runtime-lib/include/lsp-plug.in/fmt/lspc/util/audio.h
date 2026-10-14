/*
 * Copyright (C) 2025 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2025 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 24 окт. 2022 г.
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

#ifndef LSP_PLUG_IN_FMT_LSPC_UTIL_AUDIO_H_
#define LSP_PLUG_IN_FMT_LSPC_UTIL_AUDIO_H_

#include <lsp-plug.in/runtime/version.h>

#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/fmt/lspc/File.h>
#include <lsp-plug.in/fmt/lspc/IAudioFormatSelector.h>
#include <lsp-plug.in/mm/IInAudioStream.h>
#include <lsp-plug.in/mm/IOutAudioStream.h>
#include <lsp-plug.in/io/Path.h>
#include <lsp-plug.in/runtime/LSPString.h>

namespace lsp
{
    namespace lspc
    {
        /**
         * Write audio file as a dedicated chunk to the LSPC file
         * @param chunk_id pointer to store allocated chunk identifier, can be NULL
         * @param file the LSPC file to write the chunk
         * @param path path to file to write
         * @param selector audio format selector, default one will be used if none provided
         * @param buf_size size of buffer for I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t write_audio(
            chunk_id_t *chunk_id, File *file,
            const char *path, IAudioFormatSelector *selector = NULL, size_t buf_size = 0x1000);

        LSP_RUNTIME_LIB_PUBLIC
        status_t write_audio(
            chunk_id_t *chunk_id, File *file,
            const io::Path *path, IAudioFormatSelector *selector = NULL, size_t buf_size = 0x1000);

        LSP_RUNTIME_LIB_PUBLIC
        status_t write_audio(
            chunk_id_t *chunk_id, File *file,
            const LSPString *path, IAudioFormatSelector *selector = NULL, size_t buf_size = 0x1000);

        /**
         * Write audio entry from memory to the LSPC file
         * @param chunk_id pointer to store allocated chunk identifier, can be NULL
         * @param file the LSPC file to write the chunk
         * @param frames pointer to the array with packed frames
         * @param params audio parameters
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t write_audio(
            chunk_id_t *chunk_id, File *file,
            const float *frames, const audio_parameters_t *params);

        /**
         * Write audio file as a dedicated chunk to the LSPC file
         * @param chunk_id pointer to store allocated chunk identifier, can be NULL
         * @param file the LSPC file to write the chunk
         * @param is audio input stream to read data
         * @param selector audio format selector, default one will be used if none provided
         * @param buf_size size of buffer for I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t write_audio(
            chunk_id_t *chunk_id, File *file,
            mm::IInAudioStream *is, IAudioFormatSelector *selector = NULL, size_t buf_size = 0x1000);


        /**
         * Read audio entry from LSPC file to other file
         * @param chunk_id chunk identifier
         * @param file the LSPC file to read the chunk
         * @param path path to destination file
         * @param format output audio format (@see mm::IOutAudioStream specificaion)
         * @param codec output audio codec (@see mm::IOutAudioStream specificaion)
         * @param buf_size size of buffer of I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_audio(
            chunk_id_t chunk_id, File *file,
            const char *path, size_t format, size_t codec, size_t buf_size = 0x1000);

        LSP_RUNTIME_LIB_PUBLIC
        status_t read_audio(
            chunk_id_t chunk_id, File *file,
            const LSPString *path, size_t format, size_t codec, size_t buf_size = 0x1000);

        LSP_RUNTIME_LIB_PUBLIC
        status_t read_audio(
            chunk_id_t chunk_id, File *file,
            const io::Path *path, size_t format, size_t codec, size_t buf_size = 0x1000);

        /**
         * Read audio entry to the memory buffer
         * @param chunk_id chunk identifier
         * @param file the LSPC file to read the chunk
         * @param frames pointer to store audio frames converted to f32 sample format, should be free()'d by caller
         * @param params audio parameters stored in the chunk
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_audio(
            chunk_id_t chunk_id, File *file,
            float **frames, audio_parameters_t *params);

        /**
         * Read audio entry to the output audio stream
         * @param chunk_id chunk identifier
         * @param file the LSPC file to read the chunk
         * @param os pointer to the stream to commit sample data
         * @param params audio parameters stored in the chunk
         * @param buf_size size of buffer of I/O operations
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_audio(
            chunk_id_t chunk_id, File *file,
            mm::IOutAudioStream *os, audio_parameters_t *params, size_t buf_size = 0x1000);

        /**
         * Read audio entry and return the pointer to the multimedia input stream
         * @param chunk_id chunk identifier
         * @param file the LSPC file to read the chunk
         * @param is pointer to store the multimedia audio stream
         * @return status of operation
         */
        LSP_RUNTIME_LIB_PUBLIC
        status_t read_audio(chunk_id_t chunk_id, File *file, mm::IInAudioStream **is);

    } /* namespace lspc */
} /* namespace lsp */



#endif /* LSP_PLUG_IN_FMT_LSPC_UTIL_AUDIO_H_ */
