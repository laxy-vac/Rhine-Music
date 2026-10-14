/*
 * Copyright (C) 2020 Linux Studio Plugins Project <https://lsp-plug.in/>
 *           (C) 2020 Vladimir Sadovnikov <sadko4u@gmail.com>
 *
 * This file is part of lsp-runtime-lib
 * Created on: 30 апр. 2020 г.
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

#ifndef LSP_PLUG_IN_FMT_CONFIG_ICONFIGHANDLER_H_
#define LSP_PLUG_IN_FMT_CONFIG_ICONFIGHANDLER_H_

#include <lsp-plug.in/runtime/version.h>
#include <lsp-plug.in/common/status.h>
#include <lsp-plug.in/fmt/config/types.h>

namespace lsp
{
    namespace config
    {
        /**
         * Configuration handler
         */
        class IConfigHandler
        {
            public:
                explicit IConfigHandler();
                IConfigHandler(const IConfigHandler &) = delete;
                IConfigHandler(IConfigHandler &&) = delete;
                virtual ~IConfigHandler();

                IConfigHandler & operator = (const IConfigHandler &) = delete;
                IConfigHandler & operator = (IConfigHandler &&) = delete;

            public:
                /**
                 * Indicates begin of parsing config
                 * @return status of operation
                 */
                virtual status_t start();

                /**
                 * Indicates end of parsing config
                 * @param res final result
                 * @return status of operation
                 */
                virtual status_t finish(status_t res);

                /**
                 * Handle parameter. By default it dispatches calls to other handle_* methods
                 * @param param parameter to handle
                 * @return status of operation
                 */
                virtual status_t handle(const param_t *param);

                virtual status_t handle_i32(const LSPString *name, int32_t value, size_t flags);

                virtual status_t handle_u32(const LSPString *name, uint32_t value, size_t flags);

                virtual status_t handle_f32(const LSPString *name, float value, size_t flags);

                virtual status_t handle_i64(const LSPString *name, int64_t value, size_t flags);

                virtual status_t handle_u64(const LSPString *name, uint64_t value, size_t flags);

                virtual status_t handle_f64(const LSPString *name, double value, size_t flags);

                virtual status_t handle_string(const LSPString *name, const LSPString *value, size_t flags);

                virtual status_t handle_bool(const LSPString *name, bool value, size_t flags);

                virtual status_t handle_blob(const LSPString *name, const blob_t *value, size_t flags);

        };
    
    } /* namespace config */
} /* namespace lsp */

#endif /* LSP_PLUG_IN_FMT_CONFIG_ICONFIGHANDLER_H_ */
